.PHONY: local deploy destroy

local:       ## Run app + DynamoDB Local in Docker → http://localhost:3000
	docker compose up --build

bootstrap:   ## Bootstrap the AWS account for CDK
	cd infra && npm install && npx cdk bootstrap

deploy:      ## Build the image and deploy everything to AWS (needs AWS credentials)
	cd infra && npm install && npx cdk deploy --require-approval never

destroy:     ## Delete every resource
	cd infra && npx cdk destroy --force
