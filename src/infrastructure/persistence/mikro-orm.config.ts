import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';

function databasePort(): number {
  const rawPort = process.env.DATABASE_PORT ?? '5432';
  const port = Number.parseInt(rawPort, 10);

  if (!Number.isSafeInteger(port) || port <= 0) {
    throw new Error(`Invalid DATABASE_PORT: ${rawPort}`);
  }

  return port;
}

export default defineConfig({
  dbName: process.env.DATABASE_NAME ?? 'jungle_gaming',
  discovery: {
    warnWhenNoEntities: false,
  },
  entities: [],
  entitiesTs: [],
  extensions: [Migrator],
  host: process.env.DATABASE_HOST ?? 'localhost',
  migrations: {
    allOrNothing: true,
    path: './dist/src/infrastructure/persistence/migrations',
    pathTs: './src/infrastructure/persistence/migrations',
    transactional: true,
  },
  password: process.env.DATABASE_PASSWORD ?? 'jungle',
  port: databasePort(),
  user: process.env.DATABASE_USER ?? 'jungle',
});
