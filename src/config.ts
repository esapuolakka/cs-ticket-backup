import 'dotenv/config';

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  isDev: process.env.NODE_ENV !== 'production',

  // Load fictional demo tickets on startup if the table is empty (demo deployments).
  seedDemoData: process.env.SEED_DEMO_DATA === 'true',

  // Shared secret expected on the X-Origin-Verify header. Set in production so the
  // app only serves requests that came through the CloudFront distribution
  // (which attaches this header), not ones hitting the load balancer directly.
  originVerifySecret: process.env.ORIGIN_VERIFY_SECRET || '',

  aws: {
    region: process.env.AWS_REGION || 'eu-west-1',
    dynamoTable: process.env.DYNAMODB_TABLE || 'cs-tickets',
    dynamoEndpoint: process.env.DYNAMODB_ENDPOINT, // e.g. http://localhost:8000
  },

  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID || '',
    clientId: process.env.COGNITO_CLIENT_ID || '',
    clientSecret: process.env.COGNITO_CLIENT_SECRET || '',
    domain: process.env.COGNITO_DOMAIN || '',
    callbackUrl: process.env.COGNITO_CALLBACK_URL || '',
    get issuer() {
      return `https://cognito-idp.${config.aws.region}.amazonaws.com/${this.userPoolId}`;
    },
    get jwksUri() {
      return `${this.issuer}/.well-known/jwks.json`;
    },
    get tokenEndpoint() {
      return `https://${this.domain}/oauth2/token`;
    },
    get authorizeEndpoint() {
      return `https://${this.domain}/oauth2/authorize`;
    },
    get logoutEndpoint() {
      return `https://${this.domain}/logout`;
    },
  },
} as const;

export type Config = typeof config;
export default config;
