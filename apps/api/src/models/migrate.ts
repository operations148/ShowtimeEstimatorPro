import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'url';
import path from 'path';

// Default to dev.db next to the api package root (../../ from src/models/)
const databasePath =
  process.env['DATABASE_URL'] ??
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dev.db');

// Resolve migrations folder: src/models/migrate.ts → ../../drizzle → apps/api/drizzle/
const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

try {
  const sqlite = new Database(databasePath);
  const db = drizzle(sqlite);

  console.log('Running migrations from:', migrationsFolder);
  migrate(db, { migrationsFolder });
  console.log('✅ Migrations complete');

  sqlite.close();
} catch (err: unknown) {
  console.error('❌ Migration failed:', err);
  process.exit(1);
}
