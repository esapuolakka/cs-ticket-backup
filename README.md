# Ticket Search

A searchable archive for support tickets exported from Zendesk. Fastify + EJS app, DynamoDB
storage, Cognito login — packaged as a Docker image and deployed to AWS with the CDK.
Built to be spun up for a demo and torn down again with one command each.

```
Browser ─HTTPS─▶ CloudFront ─▶ ALB ─▶ ECS Fargate (Docker) ─▶ DynamoDB
                 (*.cloudfront.net)            └────────────▶ Cognito (hosted UI login)
```

## Run locally (no AWS account needed)

```
docker compose up --build      # or: make local
```

Open http://localhost:3000. The app runs against DynamoDB Local, loads a set of fictional
tickets, and skips login (you're a dev user).

Without Docker: `cp .env.example .env && npm install && npm run dev`, with DynamoDB Local
running on port 8000 and `SEED_DEMO_DATA=true`.

## Deploy to AWS

Prerequisites: AWS credentials, Docker running, Node 20+.

```
cd infra && npm install && npx cdk bootstrap   # once per account/region
make deploy
```

CDK builds the Docker image, pushes it to ECR and creates the stack (about 5–10 minutes,
mostly CloudFront). The outputs show the **SiteUrl** and a **demo login**
(`demo@example.com` / `Demo-Passw0rd!` by default — override with
`-c demoUserEmail=... -c demoUserPassword=...`).

The container loads the fictional demo tickets into an empty table on startup.
To load real tickets from Zendesk, set `ZENDESK_*` in `.env` and run `npm run import-zendesk`
against the table.

Apple Silicon is the default target (Fargate ARM64). On x86 machines add
`-c cpuArchitecture=x86_64`.

## Destroy

```
make destroy
```

Everything in the stack is created with `RemovalPolicy.DESTROY` — the table, user pool, secrets,
logs and container images go with it. While running, the ALB and Fargate task cost roughly
$1 per day; there is no NAT gateway. `cdk bootstrap` leaves a small S3 bucket and ECR
repository (`CDKToolkit` stack) that you can delete when you're finished with CDK entirely.

## Design notes

- **HTTPS without a domain:** CloudFront's default domain provides TLS, so no Route 53 zone or
  ACM certificate is needed.
- **Origin lock:** CloudFront adds a generated secret header; the app returns 404 for requests
  without it, so the ALB can't be used to bypass CloudFront (health checks are exempt).
- **No NAT:** the Fargate task runs in a public subnet with a public IP, avoiding NAT cost.
- **Secrets:** the Cognito client secret and the origin secret are stored in Secrets Manager
  and injected into the task.
- **Auth:** Cognito hosted UI with the authorization-code flow; the app verifies the ID token
  against the user pool's JWKS. Self-sign-up is disabled.

## Layout

| Path | Purpose |
|---|---|
| `src/` | Fastify app (routes, auth/DynamoDB plugins, EJS views, demo data) |
| `scripts/` | Table creation, seeding, Cognito user creation, Zendesk import |
| `infra/` | CDK app (`lib/ticket-search-stack.ts`) |
| `Dockerfile`, `docker-compose.yml` | Container image and local environment |
