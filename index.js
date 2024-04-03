const cron = require('node-cron');
const { gql, GraphQLClient } = require('graphql-request')
require('dotenv').config(); 


const ENDPOINT = 'https://backboard.railway.app/graphql/v2';

async function railwayGraphQLRequest(query, variables) {
    const client = new GraphQLClient(ENDPOINT, {
        headers: {
            Authorization: `Bearer ${process.env.RAILWAY_API_TOKEN}`,
        },
    })
    try {
        return await client.request({ document: query, variables })
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

async function getMetrics(projectId, serviceId) {
    console.log("Getting Metrics...")
    console.log("Project ID:", projectId)
    console.log("Service ID:", serviceId)
    // Get current DateTime
    const date = new Date();
    try {
        let query = 
        `query metrics($startDate: DateTime!, $projectId: String!, $serviceId: String! = "") {
            metrics(
              projectId: $projectId
              measurements: MEMORY_USAGE_GB
              startDate: $startDate
              serviceId: $serviceId
            ) {
                values {
                    ts
                    value
                    }
                measurement
            }
          }`

        let variables = {
            "projectId": projectId,
            "serviceId": serviceId,
            "startDate": date.toISOString(),
        }

        return await railwayGraphQLRequest(query, variables)
    } catch (error) {
        console.log(`Action failed with error: ${error}`);
    }
}

async function getService(serviceId) {
    let query =
        `query environments($id: String!) {
            service(id: $id) {
                name
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
            const serviceId = serviceInstance.node.serviceInstances.edges[0].node.serviceId;
            // Print out all json data for the service
            const { service } = await getService(serviceId);  
            // Check the service name to see if it matches the service we are looking for
            if (service.name === process.env.TARGET_SERVICE_NAME) {
                // Restart the service
                // Get the metrics for the service
                const { metrics } = await getMetrics(process.env.RAILWAY_PROJECT_ID, serviceId);
                // Compare the metrics to the threshold process.en.MAX_RAM_GB
                // If the metrics are greater than the threshold, restart the service
                const latestMetric = metrics[0].values[0].value;
                console.log("Current Ram Usage:", latestMetric)
                console.log("Max Ram Usage:", Number(process.env.MAX_RAM_GB))
                if (latestMetric > Number(process.env.MAX_RAM_GB)) {
                    const deploymentId = serviceInstance.node.deployments.edges[0].node.id;
                    await deploymentInstanceRestart(deploymentId);
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
            const serviceId = serviceInstance.node.serviceInstances.edges[0].node.serviceId;
            // Print out all json data for the service
            const { service } = await getService(serviceId);  
            // Check the service name to see if it matches the service we are looking for
            if (service.name === process.env.TARGET_SERVICE_NAME) {
                // Restart the service
                const deploymentId = serviceInstance.node.deployments.edges[0].node.id;
                await deploymentInstanceRestart(deploymentId);   
            }
        }
    } catch (error) {
        console.error('Error in API calls:', error);
        // Handle the error, e.g., fail the action
        console.log('API calls failed');
    }
}

if (process.env.MAX_RAM_CRON_INTERVAL_CHECK) {
    cron.schedule(process.env.MAX_RAM_CRON_INTERVAL_CHECK, async () => {
        console.log('Checking Ram Usage...');
        checkRamRestart();
      });;
}
if (process.env.CRON_INTERVAL_RESTART) {
    cron.schedule(process.env.CRON_INTERVAL_RESTART, async () => {
        console.log('Restarting Service...');
        forceRestart();
      });;
}

