import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';

// Migrations run against the DIRECT connection (port 5432), not the transaction
// pooler — DDL and multi-statement migrations need a session connection.
const url = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];
if (!url) {
  console.error('❌ DIRECT_URL or DATABASE_URL must be set to run migrations');
  process.exit(1);
}

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

const needsSsl = !/localhost|127\.0\.0\.1/.test(url);

async function main() {
  const pool = new Pool({ connectionString: url, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });
  const db = drizzle(pool);
  console.log('Running migrations from:', migrationsFolder);
  await migrate(db, { migrationsFolder });
  console.log('✅ Migrations complete');
  await pool.end();
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
