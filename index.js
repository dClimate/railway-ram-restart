const { gql, GraphQLClient } = require('graphql-request')
const { Cron } = require("croner");
require('dotenv').config(); 


const ENDPOINT = 'https://backboard.railway.app/graphql/v2';

const graphqlClient = new GraphQLClient(ENDPOINT, {
    headers: {
        Authorization: `Bearer ${process.env.RAILWAY_API_TOKEN}`,
    },
    cache: 'no-cache',
})

async function railwayGraphQLRequest(query, variables) {
    try {
        return await graphqlClient.request({ document: query, variables })
    } catch (error) {
        console.log(`Action failed with error: ${error}`);
    }
}

async function getEnvironments() {
    let query =
        `query environments($projectId: String!) {
            environments(projectId: $projectId) {
                edges {
                    node {
                        id
                        name
                        deployments {
                            edges {
                                node {
                                    id
                                    status
                                }
                            }
                        }
                        serviceInstances {
                            edges {
                                node {
                                    id
                                    domains {
                                        serviceDomains {
                                            domain
                                        }
                                    }
                                    serviceId
                                    startCommand
                                }
                            }
                        }
                    }
                }
            }
        }`
    
    const variables = {
        "projectId": process.env.RAILWAY_PROJECT_ID,
    }

    return await railwayGraphQLRequest(query, variables)
}

async function deploymentInstanceRestart(deploymentId) {
    console.log("Restarting Deployment...")
    console.log("Deployment ID:", deploymentId)
    try {
        let query = gql`
        mutation deploymentRestart($deploymentId: String!) {
            deploymentRestart(id: $deploymentId)
        }
        `
        let variables = {
            "deploymentId": deploymentId,
        }
        return await railwayGraphQLRequest(query, variables)
    } catch (error) {
        console.log(`Action failed with error: ${error}`);
    }
}

async function getMetrics(projectId, serviceId, environmentId) {
    console.log("Getting Metrics...")
    console.log("Project ID:", projectId)
    console.log("Service ID:", serviceId)
    console.log("Environment ID:", environmentId)
    // Get current DateTime
    const date = new Date();
    try {
        let query = 
        `query metrics($startDate: DateTime!, $projectId: String!, $serviceId: String, $environmentId: String) {
            metrics(
              projectId: $projectId
              measurements: MEMORY_USAGE_GB
              startDate: $startDate
              serviceId: $serviceId
              environmentId: $environmentId
              groupBy: [SERVICE_ID, DEPLOYMENT_INSTANCE_ID, DEPLOYMENT_ID]
            ) {
                values {
                    ts
                    value
                }
                measurement
                tags {
                    serviceId
                    deploymentInstanceId
                    deploymentId
                }
            }
          }`

        let variables = {
            "projectId": projectId,
            "serviceId": serviceId,
            "startDate": date.toISOString(),
            "environmentId": environmentId,
        }

        return await railwayGraphQLRequest(query, variables)
    } catch (error) {
        console.log(`Action failed with error: ${error}`);
    }
}

function getLatestMetricValue(metric) {
    if (!metric?.values?.length) return null;
    const latestPoint = metric.values.reduce((latest, current) => {
        return new Date(current.ts) > new Date(latest.ts) ? current : latest;
    });
    return latestPoint.value;
}

async function getService(serviceId) {
    let query =
        `query environments($id: String!) {
            service(id: $id) {
                name
                deployments {
                    edges {
                      node {
                        status
                        id
                        environmentId
                      }
                    }
                }
            }
        }`

    const variables = {
        "id": serviceId,
    }

    return await railwayGraphQLRequest(query, variables)
}


async function checkRamRestart() {
    try {
        // Get Environments to check if the environment already exists
        let response = await getEnvironments();
        // Filter the response to only include the environment name we are looking to create
        const targetEnvironment = response.environments.edges.filter((edge) => edge.node.name === process.env.RAILWAY_ENVIRONMENT_NAME);
        // Get all the services in the target environment
        for (const serviceInstance of targetEnvironment) {
            for (const deployment of serviceInstance.node.serviceInstances.edges) {
                const serviceId = deployment.node.serviceId;
                const { service } = await getService(serviceId);  
                // Check the service name to see if it matches the service we are looking for
                if (service.name === process.env.TARGET_SERVICE_NAME) {
                    // Get the metrics for the service
                    const { metrics } = await getMetrics(process.env.RAILWAY_PROJECT_ID, serviceId, process.env.RAILWAY_ENVIRONMENT_ID);
                    const maxRamGb = Number(process.env.MAX_RAM_GB);
                    const replicaMetrics = metrics
                        .map((metric) => {
                            const latestValue = getLatestMetricValue(metric);
                            return {
                                serviceId: metric.tags?.serviceId || serviceId,
                                deploymentInstanceId: metric.tags?.deploymentInstanceId || null,
                                deploymentId: metric.tags?.deploymentId || null,
                                latestMemoryUsageGb: latestValue,
                                aboveThreshold: latestValue !== null && latestValue >= maxRamGb,
                            };
                        })
                        .filter((metric) => metric.latestMemoryUsageGb !== null);

                    console.log("Replica metrics:");
                    console.log(JSON.stringify(replicaMetrics, null, 2));
                    console.log("Max Ram Usage:", maxRamGb);

                    const replicaOverThreshold = replicaMetrics.find((metric) => metric.aboveThreshold);
                    if (replicaOverThreshold) {
                        const deploymentId = replicaOverThreshold.deploymentId || service.deployments.edges.filter((edge) => edge.node.environmentId === process.env.RAILWAY_ENVIRONMENT_ID)[0]?.node?.id;
                        if (!deploymentId) {
                            console.log("No deploymentId found for restart.");
                            continue;
                        }
                        console.log("Threshold exceeded by replica:", replicaOverThreshold.deploymentInstanceId);
                        await deploymentInstanceRestart(deploymentId);
                        console.log("Service Restarted")
                    }
                }
            }
            
  
        }
    } catch (error) {
        console.error('Error in API calls:', error);
        // Handle the error, e.g., fail the action
        console.log('API calls failed');
    }
}

async function forceRestart() {
    try {
        // Get Environments to check if the environment already exists
        let response = await getEnvironments();

        // Filter the response to only include the environment name we are looking to create
        const targetEnvironment = response.environments.edges.filter((edge) => edge.node.name === process.env.RAILWAY_ENVIRONMENT_NAME);
        // Get all the services in the target environment
        for (const serviceInstance of targetEnvironment) {
            for (const deployment of serviceInstance.node.serviceInstances.edges) {
                const serviceId = deployment.node.serviceId;
                const { service } = await getService(serviceId);  
                // Check the service name to see if it matches the service we are looking for
                if (service.name === process.env.TARGET_SERVICE_NAME) {
                    // Restart the service
                    const deploymentId = service.deployments.edges.filter((edge) => edge.node.environmentId === process.env.RAILWAY_ENVIRONMENT_ID)[0].node.id;
                    await deploymentInstanceRestart(deploymentId);   
                    console.log("Service Restarted")
                }
            } 
        }
    } catch (error) {
        console.error('Error in API calls:', error);
        // Handle the error, e.g., fail the action
        console.log('API calls failed');
    }
}

if (process.env.MAX_RAM_CRON_INTERVAL_CHECK) {
    Cron(process.env.MAX_RAM_CRON_INTERVAL_CHECK, async () => {
        console.log('Checking Ram Usage...');
        checkRamRestart();
      });;
}
if (process.env.CRON_INTERVAL_RESTART) {
    Cron(process.env.CRON_INTERVAL_RESTART, async () => {
        console.log('Restarting Service...');
        forceRestart();
      });;
}
