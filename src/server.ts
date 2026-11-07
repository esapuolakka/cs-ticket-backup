import path from 'path';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyView from '@fastify/view';
import ejs from 'ejs';
import config from './config';
import dynamodbPlugin from './plugins/dynamodb';
import authPlugin from './plugins/auth';
import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import ticketRoutes from './routes/tickets';

const fastify = Fastify({ logger: true });

// Reject anything that didn't come through the CloudFront distribution in front of this
// service. Only enforced when ORIGIN_VERIFY_SECRET is set (production).
if (config.originVerifySecret) {
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.url === '/api/health') return; // load balancer health checks
    if (request.headers['x-origin-verify'] !== config.originVerifySecret) {
      return reply.status(404).send();
    }
  });
}

// Register plugins
fastify.register(fastifyCookie);
fastify.register(fastifyFormbody);
fastify.register(fastifyView, {
  engine: { ejs },
  root: path.join(__dirname, 'views'),
});

// Register custom plugins
fastify.register(dynamodbPlugin);
fastify.register(authPlugin);

// Register routes
fastify.register(healthRoutes, { prefix: '/api' });
fastify.register(authRoutes, { prefix: '/auth' });
fastify.register(ticketRoutes);

const start = async () => {
  try {
    await fastify.listen({ port: config.port, host: config.host });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
