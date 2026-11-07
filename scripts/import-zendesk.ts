/**
 * One-time import script: fetches all tickets from Zendesk
 * and inserts them into DynamoDB.
 *
 * Usage: npm run import-zendesk
 *
 * Requires .env with ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN
 */
/// <reference types="node" />
import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Ticket } from '../src/types';

const config = {
  zendesk: {
    subdomain: process.env.ZENDESK_SUBDOMAIN!,
    email: process.env.ZENDESK_EMAIL!,
    apiToken: process.env.ZENDESK_API_TOKEN!,
    get baseUrl() {
      return `https://${this.subdomain}.zendesk.com/api/v2`;
    },
    get authHeader() {
      const creds = Buffer.from(`${this.email}/token:${this.apiToken}`).toString('base64');
      return `Basic ${creds}`;
    },
  },
  aws: {
    region: process.env.AWS_REGION || 'eu-west-1',
    tableName: process.env.DYNAMODB_TABLE || 'cs-tickets',
    endpoint: process.env.DYNAMODB_ENDPOINT,
  },
};

const client = new DynamoDBClient({
  region: config.aws.region,
  ...(config.aws.endpoint ? { endpoint: config.aws.endpoint } : {}),
});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

// --- Zendesk API helpers ---

async function zendeskFetch(url: string) {
  const res = await fetch(url, {
    headers: { Authorization: config.zendesk.authHeader },
  });
  if (!res.ok) {
    throw new Error(`Zendesk API error: ${res.status} ${res.statusText} - ${await res.text()}`);
  }
  return res.json();
}

async function* fetchAllTickets() {
  let url: string | null = `${config.zendesk.baseUrl}/tickets.json?page[size]=100`;
  while (url) {
    const data = await zendeskFetch(url);
    for (const ticket of data.tickets) {
      yield ticket;
    }
    url = data.meta?.has_more ? data.links?.next : null;
    if (url) await sleep(500);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Transform ---

function ticketToDynamo(ticket: any): Ticket {
  const subject = ticket.subject || '';
  const description = ticket.description || '';
  // Zendesk doesn't include requester name/email directly in the ticket object.
  // You may need to fetch users separately and enrich this data.
  const requester = '';
  const email = '';

  return {
    ticketId: String(ticket.id),
    subject,
    description,
    status: ticket.status,
    requester,
    email,
    tags: (ticket.tags || []).join(', '),
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    subjectLower: subject.toLowerCase(),
    descriptionLower: description.substring(0, 2000).toLowerCase(),
    requesterLower: requester.toLowerCase(),
    emailLower: email.toLowerCase(),
  };
}

// --- Main ---

async function batchWrite(items: Ticket[]) {
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25);
    await docClient.send(new BatchWriteCommand({
      RequestItems: {
        [config.aws.tableName]: batch.map((item) => ({
          PutRequest: { Item: item },
        })),
      },
    }));
    if (i + 25 < items.length) await sleep(100);
  }
}

async function main() {
  console.log('Starting Zendesk import...');
  console.log(`Zendesk subdomain: ${config.zendesk.subdomain}`);
  console.log(`DynamoDB table: ${config.aws.tableName}`);

  let ticketCount = 0;
  const buffer: Ticket[] = [];

  for await (const ticket of fetchAllTickets()) {
    buffer.push(ticketToDynamo(ticket));
    ticketCount++;

    // Flush in batches of 25
    if (buffer.length >= 25) {
      await batchWrite(buffer.splice(0, 25));
    }

    if (ticketCount % 100 === 0) {
      console.log(`Progress: ${ticketCount} tickets`);
    }
  }

  // Flush remaining
  if (buffer.length > 0) {
    await batchWrite(buffer);
  }

  console.log(`\nImport complete: ${ticketCount} tickets`);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
