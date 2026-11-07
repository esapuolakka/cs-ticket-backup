import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import type { FastifyRequest, FastifyReply } from 'fastify';
import config from '../config';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: Record<string, unknown> | null;
  }
}

export default fp(async (fastify) => {
  // In dev mode without Cognito config, skip real auth
  const skipAuth = config.isDev && !config.cognito.userPoolId;

  if (skipAuth) {
    fastify.log.warn('Auth is DISABLED — running in local dev mode');
  }

  const jwks = skipAuth
    ? null
    : jwksClient({
        jwksUri: config.cognito.jwksUri,
        cache: true,
        rateLimit: true,
      });

  function getSigningKey(kid: string): Promise<string> {
    return new Promise((resolve, reject) => {
      jwks!.getSigningKey(kid, (err, key) => {
        if (err) return reject(err);
        resolve(key!.getPublicKey());
      });
    });
  }

  async function verifyToken(token: string): Promise<Record<string, unknown>> {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string') throw new Error('Invalid token');
    const signingKey = await getSigningKey(decoded.header.kid!);
    return jwt.verify(token, signingKey, {
      issuer: config.cognito.issuer,
      algorithms: ['RS256'],
    }) as Record<string, unknown>;
  }

  fastify.decorateRequest('user', null);

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    if (skipAuth) {
      request.user = { email: 'dev@localhost', name: 'Dev User' };
      return;
    }

    const token = request.cookies.id_token;
    if (!token) {
      return reply.redirect('/auth/login');
    }
    try {
      request.user = await verifyToken(token);
    } catch (err) {
      request.log.warn({ err }, 'Token verification failed');
      return reply.redirect('/auth/login');
    }
  });
});
