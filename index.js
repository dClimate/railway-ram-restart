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
        return null;
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

function shortId(value) {
    if (!value) return "unknown";
    return value.slice(0, 8);
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
                    const metricsResponse = await getMetrics(process.env.RAILWAY_PROJECT_ID, serviceId, process.env.RAILWAY_ENVIRONMENT_ID);
                    if (!metricsResponse || !Array.isArray(metricsResponse.metrics) || metricsResponse.metrics.length === 0) {
                        console.log("No metrics available for service, skipping threshold check:", service.name);
                        continue;
                    }

                    const { metrics } = metricsResponse;
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
                    replicaMetrics.sort((a, b) => b.latestMemoryUsageGb - a.latestMemoryUsageGb);

                    const maxReplicaMemoryGb = replicaMetrics.reduce((max, metric) => {
                        return Math.max(max, metric.latestMemoryUsageGb);
                    }, 0);
                    const replicasOverThreshold = replicaMetrics.filter((metric) => metric.aboveThreshold).length;
                    console.log(
                        `[RAM] service=${service.name} replicas=${replicaMetrics.length} thresholdGb=${maxRamGb} maxReplicaGb=${maxReplicaMemoryGb.toFixed(3)} overThreshold=${replicasOverThreshold}`
                    );
                    console.log("[RAM] replicas:");
                    replicaMetrics.forEach((metric, index) => {
                        const status = metric.aboveThreshold ? "OVER" : "OK";
                        console.log(
                            `[RAM] ${index + 1}. replica=${shortId(metric.deploymentInstanceId)} usageGb=${metric.latestMemoryUsageGb.toFixed(3)} status=${status}`
                        );
                    });

                    const replicaOverThreshold = replicaMetrics.find((metric) => metric.aboveThreshold);
                    if (replicaOverThreshold) {
                        const deploymentId = replicaOverThreshold.deploymentId || service.deployments.edges.filter((edge) => edge.node.environmentId === process.env.RAILWAY_ENVIRONMENT_ID)[0]?.node?.id;
                        if (!deploymentId) {
                            console.log("No deploymentId found for restart.");
                            continue;
                        }
                        console.log(
                            `[RAM] threshold exceeded: replica=${replicaOverThreshold.deploymentInstanceId} usageGb=${replicaOverThreshold.latestMemoryUsageGb.toFixed(3)} thresholdGb=${maxRamGb}`
                        );
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
        await checkRamRestart();
      });;
}
if (process.env.CRON_INTERVAL_RESTART) {
    Cron(process.env.CRON_INTERVAL_RESTART, async () => {
        console.log('Restarting Service...');
        await forceRestart();
      });;
}
