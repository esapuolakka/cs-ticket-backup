.PHONY: local deploy destroy

local:       ## Run app + DynamoDB Local in Docker → http://localhost:3000
	docker compose up --build

bootstrap:   ## Bootstrap the AWS account for CDK
	cd infra && npm install && npx cdk bootstrap

SEED ?= true

deploy:      ## Build the image and deploy to AWS (needs AWS credentials). Skip demo data: make deploy SEED=false
	cd infra && npm install && npx cdk deploy --require-approval never -c seedDemoData=$(SEED)

destroy:     ## Delete every resource
	cd infra && npx cdk destroy --force
