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


## Railway cutover

Railway stops reading legacy configuration files on 1 December 2026.
[railway-settings.json](./railway-settings.json) records the settings for the
existing Aegis monitors.

1. In the [Aegis project](https://railway.com/project/7b1d4989-a0d3-4bb1-98de-a5372becb82d), preview and save the builder, start command, single replica, sleep setting, and restart policy on staging `railway-ram-restart` and production `railway-ram-restart-prod`. Compare them with the last successful deployment and commit the scoped settings without redeploying.
2. Merge into `main` after both services have their saved settings. The rename removes the automatically discovered root file.
3. Redeploy staging first, then production. Confirm that each deployment uses the saved settings, resolves no legacy file, and runs a normal RAM metrics poll for the intended target. Verify the monitor through its logs without forcing a target restart. Roll back to the previous healthy monitor deployment if startup fails.

[Railway migration guide](https://docs.railway.com/infrastructure-as-code#migrating-from-config-as-code)

## How To Use
```
   yarn install
   yarn start
``````
