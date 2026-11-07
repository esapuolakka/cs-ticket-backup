import type { FastifyInstance } from 'fastify';
import config from '../config';

export default async function authRoutes(fastify: FastifyInstance) {
  const skipAuth = config.isDev && !config.cognito.userPoolId;

  // Redirect to Cognito hosted login
  fastify.get('/login', async (_request, reply) => {
    if (skipAuth) {
      return reply.redirect('/');
    }
    const params = new URLSearchParams({
      client_id: config.cognito.clientId,
      response_type: 'code',
      scope: 'openid email profile',
      redirect_uri: config.cognito.callbackUrl,
    });
    return reply.redirect(`${config.cognito.authorizeEndpoint}?${params}`);
  });

  // OAuth2 callback
  fastify.get('/callback', async (request, reply) => {
    if (skipAuth) {
      return reply.redirect('/');
    }

    const { code } = request.query as { code?: string };
    if (!code) {
      return reply.status(400).send({ error: 'Missing authorization code' });
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.cognito.clientId,
      client_secret: config.cognito.clientSecret,
      redirect_uri: config.cognito.callbackUrl,
      code,
    });

    const response = await fetch(config.cognito.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      request.log.error('Token exchange failed: %s', await response.text());
      return reply.status(401).send({ error: 'Authentication failed' });
    }

    const tokens = (await response.json()) as { id_token: string; access_token: string };

    reply
      .setCookie('id_token', tokens.id_token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 3600,
      })
      .setCookie('access_token', tokens.access_token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 3600,
      });

    return reply.redirect('/');
  });

  // Logout
  fastify.get('/logout', async (_request, reply) => {
    reply
      .clearCookie('id_token', { path: '/' })
      .clearCookie('access_token', { path: '/' });

    if (skipAuth) {
      return reply.redirect('/');
    }

    const params = new URLSearchParams({
      client_id: config.cognito.clientId,
      logout_uri: config.cognito.callbackUrl.replace('/auth/callback', '/'),
    });
    return reply.redirect(`${config.cognito.logoutEndpoint}?${params}`);
  });

  // Current user info
  fastify.get('/me', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    return {
      email: request.user?.email ?? '',
      name: request.user?.name ?? request.user?.email ?? '',
    };
  });
}
