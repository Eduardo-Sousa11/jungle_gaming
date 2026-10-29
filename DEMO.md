# Roteiro de demonstração técnica

## 1. Subir e verificar a aplicação

```bash
docker compose up --build -d
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
curl http://localhost:3000/metrics
```

Explique que readiness depende de PostgreSQL e SQS, enquanto liveness verifica apenas o processo.

## 2. Criar wallet e processar aposta

Use os exemplos do `README.md`. Repita o mesmo `POST /wagering/transactions` com a mesma `Idempotency-Key`: a segunda resposta deve trazer `idempotentReplay: true` e o ledger continuará com um único débito.

## 3. Mostrar ledger e reconciliação

```bash
curl 'http://localhost:3000/wallets/WALLET_ID/ledger?limit=2'
curl -X POST 'http://localhost:3000/wallets/WALLET_ID/reconciliation'
```

Mostre o cursor opaco, os saldos anterior/posterior e `consistent: true`.

## 4. Enviar pelo SQS

Grave o envelope documentado no README em `/tmp/wager-message.json` e execute:

```bash
MESSAGE_BODY="$(tr -d '\n' < /tmp/wager-message.json)"
docker compose exec localstack awslocal sqs send-message \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/wager-transactions.fifo \
  --message-body "$MESSAGE_BODY" \
  --message-group-id WALLET_ID \
  --message-deduplication-id MESSAGE_ID
```

Consulte a transação por provider/external ID e mostre inbox processada no PostgreSQL. Reenvie o mesmo envelope para demonstrar deduplicação.

## 5. Demonstrar referências fora de ordem

Envie primeiro um `REFUND` que referencia uma BET ainda inexistente. Confirme `PENDING_REFERENCE`; envie a BET da mesma wallet, provider, rodada, moeda e valor. O worker deve convergir o REFUND para `PROCESSED`.

## 6. Mostrar outbox e observabilidade

```bash
docker compose exec postgres psql -U jungle -d jungle_gaming -c \
  "select event_type, attempts, published_at from outbox_messages order by occurred_at desc limit 10;"

curl http://localhost:3000/metrics
docker compose logs app --tail=50
```

Explique `SKIP LOCKED`, lease, backoff, entrega *at-least-once* e os logs JSON.

## 7. Executar as provas automatizadas

```bash
docker compose exec app bun run check
docker compose exec app bun run test:integration
docker compose exec app bun run test:audit
```

Finalize destacando os cenários de 50 duplicatas, saldo disputado, três instâncias, crash antes do ACK, publishers concorrentes, DLQ e auditoria financeira global.
