# Ticket Search app for Zendesk ticket data export

A small searchable archive for support tickets exported from Zendesk. It's a Fastify + EJS app
with DynamoDB for storage and Cognito for login, packaged as a Docker image and deployed to AWS
with the CDK. I built it so I can spin up a demo with one command and tear it down with another.

```
Browser ─HTTPS─▶ CloudFront ─▶ ALB ─▶ ECS Fargate (Docker) ─▶ DynamoDB
                 (*.cloudfront.net)            └────────────▶ Cognito (hosted UI login)
```

## Run locally

```
docker compose up --build      # or: make local
```

Then open http://localhost:3000. It runs against DynamoDB Local, loads some fictional tickets
and skips login (you're just a dev user).

No Docker? `cp .env.example .env && npm install && npm run dev` works too, as long as DynamoDB
Local is running on port 8000 and `SEED_DEMO_DATA=true`.

## Deploy to AWS

You need AWS credentials, Docker running and Node 20+.

```
cd infra && npm install && npx cdk bootstrap   # or make bootstrap once per account/region
make deploy
```

CDK builds the Docker image, pushes it to ECR and creates the stack. Takes about 5–10 minutes,
CloudFront is the slow part. When it's done the outputs show the **SiteUrl** and a **demo login**
(`demo@example.com` / `Demo-Passw0rd!` by default, change it with
`-c demoUserEmail=... -c demoUserPassword=...`).

You don't need a `.env` for this. The stack sets up all the Cognito and secret values itself.

The container loads the fictional demo tickets into an empty table on startup. To skip that and
start with an empty table, run `make deploy SEED=false`. If you want real
tickets instead, put the `ZENDESK_*` values in `.env` and run `npm run import-zendesk` against
the table.

It targets Apple Silicon by default (Fargate ARM64). On an x86 machine add
`-c cpuArchitecture=x86_64`.

## Destroy

```
make destroy
```

Everything in the stack uses `RemovalPolicy.DESTROY`, so the table, user pool, secrets, logs and
container images all go away. `cdk bootstrap` leaves a small S3 bucket and ECR repo behind (the
`CDKToolkit` stack), so delete that too once you're done with CDK completely.

## Design notes

- **HTTPS without a domain:** CloudFront's default domain gives me TLS, so no Route 53 zone or
  ACM certificate is needed.
- **Origin lock:** CloudFront adds a generated secret header and the app returns 404 without it.
  This stops people from hitting the ALB directly (health checks are exempt).
- **No NAT:** the Fargate task sits in a public subnet with a public IP. Saves the NAT cost.
- **Secrets:** the Cognito client secret and the origin secret live in Secrets Manager and get
  injected into the task.
- **Auth:** Cognito hosted UI with the authorization-code flow. The app checks the ID token
  against the user pool's JWKS. Self-sign-up is off.

## Layout

| Path | What's in it |
|---|---|
| `src/` | Fastify app (routes, auth/DynamoDB plugins, EJS views, demo data) |
| `scripts/` | Table creation, seeding, Cognito user creation, Zendesk import |
| `infra/` | CDK app (`lib/ticket-search-stack.ts`) |
| `Dockerfile`, `docker-compose.yml` | Container image and local setup |
| `Makefile` | Shortcuts: `local`, `deploy`, `destroy` |
