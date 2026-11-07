.PHONY: local deploy destroy

local:       ## Run app + DynamoDB Local in Docker → http://localhost:3000
	docker compose up --build

deploy:      ## Build the image and deploy everything to AWS (needs Docker + AWS credentials)
	cd infra && npm install && npx cdk deploy --require-approval never

destroy:     ## Delete every resource the stack created
	cd infra && npx cdk destroy --force
