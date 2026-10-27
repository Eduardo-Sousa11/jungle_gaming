# Regras de engenharia

## Fonte de verdade

- O README oficial do desafio é a especificação do produto.
- Mantenha o `IMPLEMENTATION_PLAN.md` atualizado após cada etapa concluída.
- Não declare que um comando ou teste passou sem que ele tenha sido executado com sucesso.

## Garantias inegociáveis

- Nunca utilize `number` do JavaScript para representar valores monetários.
- Nunca dependa de memória ou do SQS FIFO como garantia definitiva de idempotência.
- Nunca publique eventos de integração antes do commit da transação financeira.
- Nunca atualize ou exclua lançamentos do ledger.
- Nunca utilize lock global; a concorrência deve ser isolada por wallet.
- Constraints do PostgreSQL devem garantir unicidade e saldo não negativo.
- O código de domínio não pode importar pacotes do NestJS, MikroORM, PostgreSQL ou AWS.

## Arquitetura

- `domain`: entidades, objetos de valor, erros de domínio e invariantes.
- `application`: casos de uso e portas.
- `infrastructure`: PostgreSQL, MikroORM, SQS, workers e observabilidade.
- `presentation`: controladores HTTP, DTOs e mapeamento de erros.
- Utilize construtores privados com métodos fábrica `create`, `from` ou `rehydrate`.
- HTTP e SQS devem chamar o mesmo caso de uso de processamento de apostas.

## Comandos

```bash
docker run --rm -v "$PWD:/app" -w /app oven/bun:1.4.4 bun install
docker run --rm -v "$PWD:/app" -w /app oven/bun:1.4.4 bun run check
docker compose up -d postgres localstack
docker compose run --rm app bun run db:migrate
docker compose up --build app
```

## Entrega

- Implemente uma etapa rastreável por vez.
- Execute a verificação de tipos e os testes relevantes antes de cada commit.
- Utilize branches de funcionalidade e faça merge de Pull Requests revisados na `main`.
- Preserve alterações existentes e mantenha os commits limitados à etapa ativa.
