#!/bin/sh
set -eu

DLQ_URL="$(awslocal sqs create-queue \
  --queue-name "${WAGER_DLQ_NAME:-wager-transactions-dlq.fifo}" \
  --attributes FifoQueue=true,ContentBasedDeduplication=true \
  --query QueueUrl \
  --output text)"

DLQ_ARN="$(awslocal sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)"

QUEUE_ATTRIBUTES="$(printf \
  '{"FifoQueue":"true","ContentBasedDeduplication":"true","VisibilityTimeout":"30","RedrivePolicy":"{\"deadLetterTargetArn\":\"%s\",\"maxReceiveCount\":\"5\"}"}' \
  "$DLQ_ARN")"

awslocal sqs create-queue \
  --queue-name "${WAGER_QUEUE_NAME:-wager-transactions.fifo}" \
  --attributes "$QUEUE_ATTRIBUTES"
