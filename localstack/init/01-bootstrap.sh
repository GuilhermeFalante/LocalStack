#!/usr/bin/env bash
set -euo pipefail

export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-us-east-1}

echo "[init] Creating resources in LocalStack..."

# Create S3 bucket (single bucket)
awslocal s3 mb s3://shopping-images || true

# Create SNS topic
TOPIC_ARN=$(awslocal sns create-topic --name task-events --query TopicArn --output text)
echo "[init] SNS topic: ${TOPIC_ARN}"

# Create SQS queue
QUEUE_URL=$(awslocal sqs create-queue --queue-name task-queue --query QueueUrl --output text)
echo "[init] SQS queue: ${QUEUE_URL}"

# Subscribe SQS to SNS
QUEUE_ARN=$(awslocal sqs get-queue-attributes --queue-url "$QUEUE_URL" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)
awslocal sns subscribe --topic-arn "$TOPIC_ARN" --protocol sqs --notification-endpoint "$QUEUE_ARN" >/dev/null

# Allow SNS to publish to SQS (policy)
ACCOUNT_ID=$(awslocal sts get-caller-identity --query Account --output text)
cat > /tmp/sqs_policy.json <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "Allow-SNS-SendMessage",
    "Effect": "Allow",
    "Principal": {"AWS": "*"},
    "Action": "sqs:SendMessage",
    "Resource": "arn:aws:sqs:${AWS_DEFAULT_REGION}:${ACCOUNT_ID}:task-queue",
    "Condition": {
      "ArnEquals": {"aws:SourceArn": "${TOPIC_ARN}"}
    }
  }]
}
POLICY
awslocal sqs set-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attributes Policy="$(cat /tmp/sqs_policy.json)"

# Create DynamoDB table
awslocal dynamodb create-table \
  --table-name Tasks \
  --attribute-definitions AttributeName=taskId,AttributeType=S \
  --key-schema AttributeName=taskId,KeyType=HASH \
  --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
  >/dev/null || true

# Enable bucket public (LocalStack only)
awslocal s3api put-bucket-acl --bucket shopping-images --acl public-read || true

echo "[init] Done."
