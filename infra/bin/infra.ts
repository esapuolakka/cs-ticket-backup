#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { TicketSearchStack } from '../lib/ticket-search-stack';

const app = new App();

new TicketSearchStack(app, 'TicketSearchStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'eu-west-1',
  },
  demoUserEmail: app.node.tryGetContext('demoUserEmail') ?? 'demo@example.com',
  demoUserPassword: app.node.tryGetContext('demoUserPassword') ?? 'Demo-Passw0rd!',
  cpuArchitecture: app.node.tryGetContext('cpuArchitecture') ?? 'arm64',
});
