import type { FastifyInstance } from 'fastify';
import { ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { ScanCommandInput } from '@aws-sdk/lib-dynamodb';
import type { SearchParams, Ticket, SearchResult } from '../types';

function truncate(text: string, maxLen = 80): string {
  if (!text) return '';
  const clean = text.replace(/[\r\n]+/g, ' ').trim();
  return clean.length > maxLen ? clean.substring(0, maxLen) + '...' : clean;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('fi-FI', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export default async function ticketRoutes(fastify: FastifyInstance) {
  // All ticket routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // Search page (GET /)
  fastify.get('/', async (request, reply) => {
    const { q = '', startDate = '', endDate = '', lastKey } = request.query as SearchParams;
    const searched = !!(q || startDate || endDate || lastKey);
    const userName = (request.user?.name ?? request.user?.email ?? '') as string;

    let items: Ticket[] = [];
    let nextKey: string | null = null;

    if (searched) {
      const result = await scanTickets(fastify, {
        q: q || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        pageLimit: 50,
        lastKey,
      });
      items = result.items;
      nextKey = result.nextKey;
    }

    return reply.view('index.ejs', {
      items,
      nextKey,
      searched,
      q,
      startDate,
      endDate,
      userName,
      truncate,
      formatDate,
    });
  });

  // Ticket detail page (GET /tickets/:ticketId)
  fastify.get('/tickets/:ticketId', async (request, reply) => {
    const { ticketId } = request.params as { ticketId: string };

    const result = await fastify.dynamodb.send(new GetCommand({
      TableName: fastify.tableName,
      Key: { ticketId },
    }));

    const ticket = result.Item as Ticket | undefined;

    if (!ticket) {
      return reply.status(404).send('Ticket not found');
    }

    return reply.view('ticket.ejs', { ticket, formatDate });
  });
}

interface ScanParams {
  q?: string;
  startDate?: string;
  endDate?: string;
  pageLimit: number;
  lastKey?: string;
}

async function scanTickets(fastify: FastifyInstance, params: ScanParams): Promise<SearchResult> {
  const { q, startDate, endDate, pageLimit, lastKey } = params;
  const filterParts: string[] = [];
  const exprValues: Record<string, unknown> = {};

  if (q) {
    const qLower = q.toLowerCase();
    filterParts.push(
      '(contains(subjectLower, :q) OR contains(descriptionLower, :q) OR contains(requesterLower, :q) OR contains(emailLower, :q))'
    );
    exprValues[':q'] = qLower;
  }

  if (startDate) {
    filterParts.push('createdAt >= :startDate');
    exprValues[':startDate'] = startDate;
  }

  if (endDate) {
    filterParts.push('createdAt <= :endDate');
    exprValues[':endDate'] = endDate;
  }

  const scanParams: ScanCommandInput = {
    TableName: fastify.tableName,
    Limit: pageLimit,
  };

  if (filterParts.length > 0) {
    scanParams.FilterExpression = filterParts.join(' AND ');
    scanParams.ExpressionAttributeValues = exprValues;
  }

  if (lastKey) {
    scanParams.ExclusiveStartKey = JSON.parse(Buffer.from(lastKey, 'base64url').toString());
  }

  const result = await fastify.dynamodb.send(new ScanCommand(scanParams));

  return {
    items: (result.Items ?? []) as Ticket[],
    count: result.Count ?? 0,
    nextKey: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url')
      : null,
  };
}
