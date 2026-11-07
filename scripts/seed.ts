import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { demoTickets } from '../src/demo-data';

const region = process.env.AWS_REGION || 'eu-west-1';
const tableName = process.env.DYNAMODB_TABLE || 'cs-tickets';
const endpoint = process.env.DYNAMODB_ENDPOINT;

const client = new DynamoDBClient({
  region,
  ...(endpoint ? {
    endpoint,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  } : {}),
});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

async function seed() {
  console.log(`Seeding ${demoTickets.length} tickets into "${tableName}"...`);
  for (let i = 0; i < demoTickets.length; i += 25) {
    await docClient.send(new BatchWriteCommand({
      RequestItems: {
        [tableName]: demoTickets.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })),
      },
    }));
  }
  console.log('Seed complete.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
