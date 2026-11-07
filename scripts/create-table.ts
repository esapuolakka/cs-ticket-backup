import 'dotenv/config';
import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';

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

async function createTable() {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`Table "${tableName}" already exists.`);
  } catch (err: any) {
    if (err.name === 'ResourceNotFoundException') {
      console.log(`Creating table "${tableName}"...`);
      await client.send(new CreateTableCommand({
        TableName: tableName,
        KeySchema: [
          { AttributeName: 'ticketId', KeyType: 'HASH' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'ticketId', AttributeType: 'S' },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      }));
      console.log('Table created successfully.');
    } else {
      throw err;
    }
  }
}

createTable().catch(console.error);
