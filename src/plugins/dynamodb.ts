import fp from 'fastify-plugin';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import config from '../config';
import { seedDemoData } from '../demo-seed';

declare module 'fastify' {
  interface FastifyInstance {
    dynamodb: DynamoDBDocumentClient;
    tableName: string;
  }
}

export default fp(async (fastify) => {
  const clientConfig: ConstructorParameters<typeof DynamoDBClient>[0] = {
    region: config.aws.region,
  };

  if (config.aws.dynamoEndpoint) {
    clientConfig.endpoint = config.aws.dynamoEndpoint;
    clientConfig.credentials = { accessKeyId: 'local', secretAccessKey: 'local' };
  }

  const client = new DynamoDBClient(clientConfig);
  const docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });

  fastify.decorate('dynamodb', docClient);
  fastify.decorate('tableName', config.aws.dynamoTable);

  if (config.seedDemoData) {
    // DynamoDB Local may still be starting (docker compose) — retry for ~30s.
    for (let attempt = 1; ; attempt++) {
      try {
        await seedDemoData(client, docClient, config.aws.dynamoTable, !!config.aws.dynamoEndpoint, fastify.log);
        break;
      } catch (err) {
        if (attempt >= 10) throw err;
        fastify.log.warn(`Seeding failed (attempt ${attempt}), retrying in 3s`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
});
