# Railway Ram Monitor

## Introduction to Railway
[Railway](https://railway.app/) is a PaaS Cloud Service which makes it easy to deploy simple or complex services which can depend on many other services (APIs Databases etc)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/1FHSG9?referralCode=ChuY7I)

## Inputs

| Name                |         Required         | Default | Description                                                                                       |
|---------------------|:------------------------:|---------|---------------------------------------------------------------------------------------------------|
| RAILWAY_API_TOKEN        | [x] |         | Railway Token. See: https://railway.app/account/tokens                                       |
| RAILWAY_PROJECT_ID      |  [x]    |  |The id of the project to create environments on. Can be found on Settings -> General page                               |
| RAILWAY_ENVIRONMENT_NAME        | [x]|         | The name of the environment to find the deployment.                                 |
| RAILWAY_ENVIRONMENT_ID        | [x]|         | The id of the environment to find the deployment.                                 |
| TARGET_SERVICE_NAME       | [x] |         | The name of the service you want to target in Railway                |
| MAX_RAM_GB         | []  |         | The max ram  threshold to trigger a restart. Required if using MAX_RAM_CRON_INTERVAL_CHECK  |
| MAX_RAM_CRON_INTERVAL_CHECK         | []  |         | The cron interval. Example "*/1 * * * *" |
| CRON_INTERVAL_RESTART         | []  |         |  The cron interval to restart regardless of the ram usage|


## How To Use
```
   yarn install
   yarn start
``````
