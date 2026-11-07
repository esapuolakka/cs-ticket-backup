/**
 * Creates a support agent's Cognito account. Self-signup is disabled, so this is
 * the only way to grant someone access.
 *
 * Usage: npm run create-cognito-user -- agent@example.com
 *
 * Cognito emails the agent a temporary password; they're prompted to set a new one
 * on first login through the hosted UI.
 */
import 'dotenv/config';
import { CognitoIdentityProviderClient, AdminCreateUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const region = process.env.AWS_REGION || 'eu-west-1';
const userPoolId = process.env.COGNITO_USER_POOL_ID;

const email = process.argv[2];

async function main() {
  if (!userPoolId) {
    throw new Error('COGNITO_USER_POOL_ID is not set in .env');
  }
  if (!email) {
    throw new Error('Usage: npm run create-cognito-user -- <email>');
  }

  const client = new CognitoIdentityProviderClient({ region });

  await client.send(new AdminCreateUserCommand({
    UserPoolId: userPoolId,
    Username: email,
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
    ],
    DesiredDeliveryMediums: ['EMAIL'],
  }));

  console.log(`Created user "${email}" — Cognito has emailed them a temporary password.`);
}

main().catch((err) => {
  console.error('Failed to create user:', err);
  process.exit(1);
});
