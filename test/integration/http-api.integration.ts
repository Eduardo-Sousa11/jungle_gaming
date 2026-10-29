import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/postgresql';

import { AppModule } from '../../src/app.module';
import { createApplicationValidationPipe } from '../../src/presentation/http/shared/application-validation.pipe';
import { NestWalletReconciliationMonitor } from '../../src/infrastructure/observability/wallet-reconciliation.monitor';
import {
  WagerTransactionFailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../src/domain/wagering/wager-transaction';

describe('Contratos HTTP de apostas', () => {
  let app: INestApplication;
  let baseUrl: string;
  let orm: MikroORM;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.useGlobalPipes(createApplicationValidationPipe());
    orm = app.get(MikroORM);
    await orm.migrator.up();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  test('cria e consulta uma carteira por HTTP', async () => {
    const wallet = await createWallet('100.00');

    const response = await fetch(`${baseUrl}/wallets/${wallet.id}`);
    const body = await responseBody(response);

    expect(response.status).toBe(200);
    expect(body['id']).toBe(wallet.id);
    expect(body['playerId']).toBe(wallet.playerId);
    expect(moneyAmount(body, 'balance')).toBe('100.00');
    expect(body['version']).toBe(1);
    expect(typeof body['createdAt']).toBe('string');
    expect(typeof body['updatedAt']).toBe('string');
  });

  test('pagina o ledger com um cursor opaco e vinculado à carteira', async () => {
    const wallet = await createWallet('100.00');
    for (let index = 0; index < 3; index += 1) {
      const wagerResponse = await postWager(wagerBody(wallet), randomUUID());
      expect(wagerResponse.status).toBe(200);
    }

    const firstResponse = await fetch(
      `${baseUrl}/wallets/${wallet.id}/ledger?limit=2`,
    );
    const first = await responseBody(firstResponse);
    const firstItems = objectArray(first, 'items');
    const cursor = first['nextCursor'];

    expect(firstResponse.status).toBe(200);
    expect(firstItems).toHaveLength(2);
    expect(typeof cursor).toBe('string');
    expect(String(cursor)).not.toContain(wallet.id);

    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    const newerWagerResponse = await postWager(wagerBody(wallet), randomUUID());
    expect(newerWagerResponse.status).toBe(200);

    const secondResponse = await fetch(
      `${baseUrl}/wallets/${wallet.id}/ledger?limit=2&cursor=${encodeURIComponent(String(cursor))}`,
    );
    const second = await responseBody(secondResponse);
    const secondItems = objectArray(second, 'items');

    expect(secondResponse.status).toBe(200);
    expect(secondItems).toHaveLength(2);
    expect(second['nextCursor']).toBeUndefined();
    expect(
      new Set([...firstItems, ...secondItems].map((entry) => entry['id'])).size,
    ).toBe(4);
    expect(
      [...firstItems, ...secondItems].every(
        (entry) => moneyAmount(entry, 'money') !== undefined,
      ),
    ).toBe(true);

    const anotherWallet = await createWallet('10.00');
    const foreignCursorResponse = await fetch(
      `${baseUrl}/wallets/${anotherWallet.id}/ledger?cursor=${encodeURIComponent(String(cursor))}`,
    );
    const foreignCursor = await responseBody(foreignCursorResponse);
    expect(foreignCursorResponse.status).toBe(400);
    expect(foreignCursor['code']).toBe('INVALID_LEDGER_CURSOR');

    const malformedCursorResponse = await fetch(
      `${baseUrl}/wallets/${wallet.id}/ledger?cursor=not%2Bbase64url`,
    );
    const malformedCursor = await responseBody(malformedCursorResponse);
    expect(malformedCursorResponse.status).toBe(400);
    expect(malformedCursor['code']).toBe('INVALID_LEDGER_CURSOR');
  });

  test('reconcilia o saldo armazenado da carteira com o ledger completo', async () => {
    const wallet = await createWallet('100.00');
    const wagerResponse = await postWager(wagerBody(wallet), randomUUID());
    expect(wagerResponse.status).toBe(200);

    const response = await fetch(
      `${baseUrl}/wallets/${wallet.id}/reconciliation`,
      { method: 'POST' },
    );
    const body = await responseBody(response);

    expect(response.status).toBe(200);
    expect(body['walletId']).toBe(wallet.id);
    expect(moneyAmount(body, 'storedBalance')).toBe('75.00');
    expect(moneyAmount(body, 'calculatedBalance')).toBe('75.00');
    expect(moneyAmount(body, 'difference')).toBe('0.00');
    expect(body['consistent']).toBe(true);
    expect(body['checkedEntries']).toBe(2);
  });

  test('sinaliza uma divergência sem alterar silenciosamente a carteira', async () => {
    const wallet = await createWallet('100.00');
    const monitor = app.get(NestWalletReconciliationMonitor);
    const previousDivergences = monitor.recordedDivergences;
    await orm.em.getConnection().execute(
      'update "wallets" set "balance" = ? where "id" = ?',
      ['90.00', wallet.id],
    );

    try {
      const response = await fetch(
        `${baseUrl}/wallets/${wallet.id}/reconciliation`,
        { method: 'POST' },
      );
      const body = await responseBody(response);

      expect(response.status).toBe(200);
      expect(moneyAmount(body, 'storedBalance')).toBe('90.00');
      expect(moneyAmount(body, 'calculatedBalance')).toBe('100.00');
      expect(moneyAmount(body, 'difference')).toBe('-10.00');
      expect(body['consistent']).toBe(false);
      expect(monitor.recordedDivergences).toBe(previousDivergences + 1);

      const walletResponse = await fetch(`${baseUrl}/wallets/${wallet.id}`);
      const unchangedWallet = await responseBody(walletResponse);
      expect(moneyAmount(unchangedWallet, 'balance')).toBe('90.00');
    } finally {
      await orm.em.getConnection().execute(
        'update "wallets" set "balance" = ? where "id" = ?',
        ['100.00', wallet.id],
      );
    }
  });

  test('exige Idempotency-Key ao enviar uma aposta', async () => {
    const wallet = await createWallet('100.00');
    const response = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(wagerBody(wallet)),
    });
    const body = await responseBody(response);

    expect(response.status).toBe(400);
    expect(body['code']).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(body['message']).toBe('O cabeçalho Idempotency-Key é obrigatório');
  });

  test('processa, reproduz e consulta uma aposta pelas duas rotas de busca', async () => {
    const wallet = await createWallet('100.00');
    const request = wagerBody(wallet);
    const idempotencyKey = randomUUID();

    const originalResponse = await postWager(request, idempotencyKey);
    const original = await responseBody(originalResponse);
    const replayResponse = await postWager(request, idempotencyKey);
    const replay = await responseBody(replayResponse);

    expect(originalResponse.status).toBe(200);
    expect(original['status']).toBe(WagerTransactionStatus.Processed);
    expect(original['idempotentReplay']).toBe(false);
    expect(moneyAmount(original, 'balance')).toBe('75.00');
    expect(replayResponse.status).toBe(200);
    expect(replay['transactionId']).toBe(original['transactionId']);
    expect(replay['idempotentReplay']).toBe(true);
    expect(moneyAmount(replay, 'balance')).toBe('75.00');

    const byIdResponse = await fetch(
      `${baseUrl}/wagering/transactions/${String(original['transactionId'])}`,
    );
    const byId = await responseBody(byIdResponse);
    expect(byIdResponse.status).toBe(200);
    expect(byId['transactionId']).toBe(original['transactionId']);
    expect(moneyAmount(byId, 'resultBalance')).toBe('75.00');

    const byProviderResponse = await fetch(
      `${baseUrl}/providers/${request.providerId}/wagering/transactions/${request.externalTransactionId}`,
    );
    const byProvider = await responseBody(byProviderResponse);
    expect(byProviderResponse.status).toBe(200);
    expect(byProvider['transactionId']).toBe(original['transactionId']);
  });

  test('retorna 409 para a mesma chave de idempotência com outro payload', async () => {
    const wallet = await createWallet('100.00');
    const request = wagerBody(wallet);
    const idempotencyKey = randomUUID();
    await postWager(request, idempotencyKey);

    const response = await postWager(
      {
        ...request,
        money: { amount: '30.00', currency: 'BRL' },
      },
      idempotencyKey,
    );
    const body = await responseBody(response);

    expect(response.status).toBe(409);
    expect(body['code']).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });

  test('retorna 422 para uma rejeição de negócio', async () => {
    const wallet = await createWallet('20.00');
    const response = await postWager(wagerBody(wallet), randomUUID());
    const body = await responseBody(response);

    expect(response.status).toBe(422);
    expect(body['status']).toBe(WagerTransactionStatus.Rejected);
    expect(body['failureCode']).toBe(
      WagerTransactionFailureCode.InsufficientFunds,
    );
    expect(moneyAmount(body, 'balance')).toBe('20.00');
  });

  test('retorna 202 quando uma referência declarada ainda não chegou', async () => {
    const wallet = await createWallet('100.00');
    const request = {
      ...wagerBody(wallet),
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: randomUUID(),
    };

    const response = await postWager(request, randomUUID());
    const body = await responseBody(response);

    expect(response.status).toBe(202);
    expect(body['status']).toBe(WagerTransactionStatus.PendingReference);
    expect(moneyAmount(body, 'balance')).toBe('100.00');
  });

  test('diferencia payloads inválidos e recursos inexistentes', async () => {
    const wallet = await createWallet('100.00');
    const invalidResponse = await postWager(
      { ...wagerBody(wallet), kind: WagerTransactionKind.Opening },
      randomUUID(),
    );
    const invalidBody = await responseBody(invalidResponse);
    expect(invalidResponse.status).toBe(400);
    expect(invalidBody['code']).toBe('VALIDATION_ERROR');
    expect(invalidBody['message']).toBe('A validação da requisição falhou');

    const unknownWalletResponse = await fetch(
      `${baseUrl}/wallets/${randomUUID()}`,
    );
    const unknownWallet = await responseBody(unknownWalletResponse);
    expect(unknownWalletResponse.status).toBe(404);
    expect(unknownWallet['code']).toBe('WALLET_NOT_FOUND');
    expect(String(unknownWallet['message'])).toContain('não foi encontrada');

    const unknownTransactionResponse = await fetch(
      `${baseUrl}/wagering/transactions/${randomUUID()}`,
    );
    const unknownTransaction = await responseBody(unknownTransactionResponse);
    expect(unknownTransactionResponse.status).toBe(404);
    expect(unknownTransaction['code']).toBe('WAGER_TRANSACTION_NOT_FOUND');
    expect(unknownTransaction['message']).toBe(
      'A transação de aposta não foi encontrada',
    );
  });

  test('retorna em português as mensagens HTTP geradas pelo framework', async () => {
    const invalidUuidResponse = await fetch(`${baseUrl}/wallets/uuid-invalido`);
    const invalidUuid = await responseBody(invalidUuidResponse);

    expect(invalidUuidResponse.status).toBe(400);
    expect(invalidUuid['code']).toBe('INVALID_UUID');
    expect(invalidUuid['message']).toBe('O parâmetro deve ser um UUID válido');

    const missingRouteResponse = await fetch(`${baseUrl}/rota-inexistente`);
    const missingRoute = await responseBody(missingRouteResponse);

    expect(missingRouteResponse.status).toBe(404);
    expect(missingRoute['message']).toBe(
      'A rota solicitada não foi encontrada',
    );
    expect(missingRoute['error']).toBe('Não encontrado');
  });

  test('expõe métricas operacionais no formato de texto do Prometheus', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(body).toContain('wager_transactions_total');
    expect(body).toContain('wager_processing_duration_seconds_count');
    expect(body).toContain('wager_lock_conflicts_total');
    expect(body).toContain('outbox_lag_seconds');
    expect(body).toContain('reconciliation_divergences_total');
  });

  async function createWallet(initialBalance: string): Promise<{
    id: string;
    playerId: string;
  }> {
    const playerId = randomUUID();
    const response = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: initialBalance, currency: 'BRL' },
      }),
    });
    const body = await responseBody(response);
    expect(response.status).toBe(201);
    if (typeof body['id'] !== 'string') {
      throw new Error('A resposta da carteira não possui identificador');
    }
    return { id: body['id'], playerId };
  }

  function postWager(
    body: Readonly<Record<string, unknown>>,
    idempotencyKey: string,
  ): Promise<Response> {
    return fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(body),
    });
  }
});

function wagerBody(wallet: { id: string; playerId: string }) {
  return {
    providerId: 'provider-a',
    externalTransactionId: randomUUID(),
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: `round-${randomUUID()}`,
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: { amount: '25.00', currency: 'BRL' },
  };
}

async function responseBody(
  response: Response,
): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function moneyAmount(
  body: Readonly<Record<string, unknown>>,
  field: string,
): string | undefined {
  const value = body[field];
  if (
    typeof value !== 'object' ||
    value === null ||
    !('amount' in value) ||
    typeof value.amount !== 'string'
  ) {
    return undefined;
  }
  return value.amount;
}

function objectArray(
  body: Readonly<Record<string, unknown>>,
  field: string,
): ReadonlyArray<Record<string, unknown>> {
  const value = body[field];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'object' && item !== null)
  ) {
    throw new Error(`${field} não é uma lista de objetos`);
  }
  return value as ReadonlyArray<Record<string, unknown>>;
}
