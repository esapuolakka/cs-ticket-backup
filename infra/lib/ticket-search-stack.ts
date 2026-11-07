import * as path from 'path';
import { Aws, CfnOutput, Duration, Fn, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface TicketSearchStackProps extends StackProps {
  demoUserEmail: string;
  demoUserPassword: string;
  cpuArchitecture: 'arm64' | 'x86_64';
}

/**
 * Be aware that everything is created with RemovalPolicy.DESTROY: `cdk destroy` leaves nothing behind. Not suitable for production.
 *
 *   Browser ─HTTPS─▶ CloudFront ─HTTP + secret header─▶ ALB ─▶ Fargate (Docker) ─▶ DynamoDB
 *                                                                  └──────────────▶ Cognito
 */
export class TicketSearchStack extends Stack {
  constructor(scope: Construct, id: string, props: TicketSearchStackProps) {
    super(scope, id, props);

    const arm = props.cpuArchitecture === 'arm64';

    // DynamoDB
    const table = new dynamodb.Table(this, 'TicketsTable', {
      partitionKey: { name: 'ticketId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Network: public subnets only. Could be made private with NAT gateway
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
    });

    // Shared secret: CloudFront adds it as a header, the app rejects requests without it
    const originVerify = new secretsmanager.Secret(this, 'OriginVerifySecret', {
      generateSecretString: { excludePunctuation: true, passwordLength: 40 },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Container service
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });

    const image = new ecr_assets.DockerImageAsset(this, 'AppImage', {
      directory: path.join(__dirname, '..', '..'), // repo root (Dockerfile + .dockerignore)
      platform: arm ? ecr_assets.Platform.LINUX_ARM64 : ecr_assets.Platform.LINUX_AMD64,
    });

    // Cognito's hosted-UI domain prefix must be globally unique
    const stackGuid = Fn.select(2, Fn.split('/', Aws.STACK_ID));
    const cognitoDomainPrefix = Fn.join('-', ['ticket-search', Fn.select(4, Fn.split('-', stackGuid))]);

    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    userPool.addDomain('Domain', { cognitoDomain: { domainPrefix: cognitoDomainPrefix } });

    const service = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster,
      cpu: 256,
      memoryLimitMiB: 512,
      desiredCount: 1,
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      publicLoadBalancer: true,
      listenerPort: 80,
      runtimePlatform: {
        cpuArchitecture: arm ? ecs.CpuArchitecture.ARM64 : ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      minHealthyPercent: 100,
      circuitBreaker: { rollback: false },
      taskImageOptions: {
        image: ecs.ContainerImage.fromDockerImageAsset(image),
        containerPort: 3000,
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: 'app',
          logGroup: new logs.LogGroup(this, 'LogGroup', {
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: RemovalPolicy.DESTROY,
          }),
        }),
        secrets: { ORIGIN_VERIFY_SECRET: ecs.Secret.fromSecretsManager(originVerify) },
      },
    });
    service.targetGroup.configureHealthCheck({
      path: '/api/health',
      interval: Duration.seconds(15),
      healthyThresholdCount: 2,
    });
    table.grantReadWriteData(service.taskDefinition.taskRole);

    // CloudFront. As a default *.cloudfront.net domain
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: new origins.HttpOrigin(service.loadBalancer.loadBalancerDnsName, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          customHeaders: { 'X-Origin-Verify': originVerify.secretValue.unsafeUnwrap() },
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      },
    });
    const siteUrl = `https://${distribution.distributionDomainName}`;

    // Cognito app client (needs the CloudFront URL for the callback)
    const userPoolClient = userPool.addClient('Client', {
      generateSecret: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [`${siteUrl}/auth/callback`],
        logoutUrls: [`${siteUrl}/`],
      },
    });
    const clientSecret = new secretsmanager.Secret(this, 'ClientSecret', {
      secretStringValue: userPoolClient.userPoolClientSecret,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const container = service.taskDefinition.defaultContainer!;
    container.addSecret('COGNITO_CLIENT_SECRET', ecs.Secret.fromSecretsManager(clientSecret));
    const env: Record<string, string> = {
      NODE_ENV: 'production',
      AWS_REGION: this.region,
      DYNAMODB_TABLE: table.tableName,
      SEED_DEMO_DATA: 'true',
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      COGNITO_DOMAIN: `${cognitoDomainPrefix}.auth.${this.region}.amazoncognito.com`,
      COGNITO_CALLBACK_URL: `${siteUrl}/auth/callback`,
    };
    for (const [k, v] of Object.entries(env)) container.addEnvironment(k, v);

    // Demo login
    const poolArn = userPool.userPoolArn;
    const createDemoUser = new cr.AwsCustomResource(this, 'DemoUser', {
      installLatestAwsSdk: false,
      onCreate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'adminCreateUser',
        parameters: {
          UserPoolId: userPool.userPoolId,
          Username: props.demoUserEmail,
          MessageAction: 'SUPPRESS',
          UserAttributes: [
            { Name: 'email', Value: props.demoUserEmail },
            { Name: 'email_verified', Value: 'true' },
          ],
        },
        physicalResourceId: cr.PhysicalResourceId.of(`demo-user-${props.demoUserEmail}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['cognito-idp:AdminCreateUser'],
          resources: [poolArn],
        }),
      ]),
    });
    const setPassword = new cr.AwsCustomResource(this, 'DemoUserPassword', {
      installLatestAwsSdk: false,
      onCreate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'adminSetUserPassword',
        parameters: {
          UserPoolId: userPool.userPoolId,
          Username: props.demoUserEmail,
          Password: props.demoUserPassword,
          Permanent: true,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`demo-user-password-${props.demoUserEmail}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['cognito-idp:AdminSetUserPassword'],
          resources: [poolArn],
        }),
      ]),
    });
    setPassword.node.addDependency(createDemoUser);

    // Outputs
    new CfnOutput(this, 'SiteUrl', { value: siteUrl, description: 'Open this in a browser' });
    new CfnOutput(this, 'DemoLoginEmail', { value: props.demoUserEmail });
    new CfnOutput(this, 'DemoLoginPassword', { value: props.demoUserPassword });
    new CfnOutput(this, 'HealthCheck', { value: `${siteUrl}/api/health` });
  }
}
