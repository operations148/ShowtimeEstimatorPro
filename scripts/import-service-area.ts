/**
 * Imports service area zip codes from attachments/service-area.sample.csv
 * into an existing tenant.
 *
 * Usage: TENANT_ID=xxx tsx scripts/import-service-area.ts
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../apps/api/src/models/schema';
import * as fs from 'fs';
import * as path from 'path';

const DB_PATH =
  process.env['DATABASE_URL'] ?? path.resolve(__dirname, '../apps/api/dev.db');

async function main() {
  const tenantId = process.env['TENANT_ID'];

  if (!tenantId) {
    console.log('Usage: TENANT_ID=xxx tsx scripts/import-service-area.ts');
    console.log('\nImports service area zip codes from the sample CSV.');
    console.log('For fresh setup, use: tsx scripts/seed.ts');
    process.exit(0);
  }

  const sqlite = new Database(DB_PATH);
  const db = drizzle(sqlite, { schema });

  const csvPath = path.resolve(__dirname, '../attachments/service-area.sample.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const zips = csvContent
    .split('\n')
    .map((line) => line.trim().replace(/\r/g, ''))
    .filter((line) => line && line !== 'zip');

  if (zips.length === 0) {
    console.log('No zip codes found in CSV.');
    process.exit(0);
  }

  // Clear existing
  db.delete(schema.serviceAreas).where(eq(schema.serviceAreas.tenantId, tenantId)).run();

  // Insert
  db.insert(schema.serviceAreas)
    .values(zips.map((zip) => ({ tenantId, zip })))
    .run();

  console.log(`✅ Imported ${zips.length} zip codes for tenant ${tenantId}`);
  sqlite.close();
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
