import { CreateTableCommand, DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { demoTickets } from './demo-data';

/**
 * Makes sure the table exists (local DynamoDB only — in AWS CDK owns the table) and
 * loads the fictional demo tickets if the table is empty. Safe to call on every start.
 */
export async function seedDemoData(
  raw: DynamoDBClient,
  doc: DynamoDBDocumentClient,
  tableName: string,
  createTable: boolean,
  log: { info: (msg: string) => void },
): Promise<void> {
  if (createTable) {
    try {
      await raw.send(new DescribeTableCommand({ TableName: tableName }));
    } catch (err: any) {
      if (err.name !== 'ResourceNotFoundException') throw err;
      await raw.send(new CreateTableCommand({
        TableName: tableName,
        KeySchema: [{ AttributeName: 'ticketId', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'ticketId', AttributeType: 'S' }],
        BillingMode: 'PAY_PER_REQUEST',
      }));
      log.info(`Created table ${tableName}`);
    }
  }

  const existing = await doc.send(new ScanCommand({ TableName: tableName, Limit: 1 }));
  if ((existing.Count ?? 0) > 0) return;

  for (let i = 0; i < demoTickets.length; i += 25) {
    await doc.send(new BatchWriteCommand({
      RequestItems: {
        [tableName]: demoTickets.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })),
      },
    }));
  }
  log.info(`Seeded ${demoTickets.length} demo tickets into ${tableName}`);
}
