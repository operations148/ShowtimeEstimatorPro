/**
 * Drops all tables (public schema), re-runs migrations, then re-seeds.
 * Use during development to get a completely clean Postgres database state.
 *
 * Usage: tsx --env-file=apps/api/.env scripts/reset-db.ts
 * Or:    pnpm --filter api db:reset
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../apps/api/src/models/schema';
import sampleQuestions from '../attachments/estimator-questions.sample.json';
import samplePricing from '../attachments/pricing-config.sample.json';
import * as fs from 'fs';
import * as path from 'path';

// Migrations must run over a direct (session) connection.
const MIGRATE_URL = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];
if (!MIGRATE_URL) {
  console.error('DIRECT_URL or DATABASE_URL must be set');
  process.exit(1);
}
const needsSsl = !/localhost|127\.0\.0\.1/.test(MIGRATE_URL);
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../apps/api/drizzle');

async function main() {
  const pool = new Pool({ connectionString: MIGRATE_URL, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });
  const db = drizzle(pool, { schema });

  // ── Step 1: Drop everything ──────────────────────────────────────────────
  console.log('🗑  Dropping public schema...');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('  ✓ Schema reset\n');

  // ── Step 2: Migrate ──────────────────────────────────────────────────────
  console.log('📦  Running migrations from:', MIGRATIONS_FOLDER);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  console.log('  ✓ All migrations applied\n');

  // ── Step 3: Seed ─────────────────────────────────────────────────────────
  console.log('🌱  Seeding database...');

  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      slug: 'demo-pools',
      name: 'Demo Pool Company',
      notificationRecipients: ['owner@demo.test'],
      serviceAreaBehavior: 'block',
    })
    .returning();
  console.log(`  ✓ Tenant: ${tenant!.name} (${tenant!.id})`);

  const [owner] = await db
    .insert(schema.users)
    .values({ tenantId: tenant!.id, email: 'owner@demo.test', name: 'Demo Owner', role: 'owner' })
    .returning();
  console.log(`  ✓ Owner: ${owner!.email} (${owner!.id})`);

  const publicKey = '26920aadc92ed1e98a274fdae4258cc7';
  const [estimator] = await db
    .insert(schema.estimators)
    .values({
      tenantId: tenant!.id,
      publicKey,
      title: sampleQuestions.title,
      status: 'published',
      branding: { primaryColor: '#2563eb' },
    })
    .returning();
  console.log(`  ✓ Estimator: ${estimator!.title} (key: ${publicKey})`);

  const questions = sampleQuestions.steps.map((step: any, idx: number) => ({
    id: step.id,
    stepId: step.id,
    type: step.type,
    label: step.label ?? step.id.replace(/_/g, ' '),
    options: step.options,
    required: true,
    order: idx,
  }));

  const [version] = await db
    .insert(schema.estimatorVersions)
    .values({ estimatorId: estimator!.id, version: 1, questions })
    .returning();
  await db
    .update(schema.estimators)
    .set({ currentVersionId: version!.id })
    .where(eq(schema.estimators.id, estimator!.id));
  console.log(`  ✓ Version 1: ${questions.length} question(s) linked`);

  await db
    .insert(schema.pricingConfigs)
    .values({ tenantId: tenant!.id, estimatorId: estimator!.id, config: samplePricing });
  console.log('  ✓ Pricing config imported');

  const csvPath = path.resolve(__dirname, '../attachments/service-area.sample.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const zips = csvContent
    .split('\n')
    .map((line) => line.trim().replace(/\r/g, ''))
    .filter((line) => line && line !== 'zip');
  if (zips.length > 0) {
    await db.insert(schema.serviceAreas).values(zips.map((zip) => ({ tenantId: tenant!.id, zip })));
  }
  console.log(`  ✓ Service area: ${zips.length} zip codes`);

  await db.insert(schema.subscriptions).values({
    tenantId: tenant!.id,
    externalId: 'mock_sub_seed',
    status: 'active',
    planId: 'estimator_pro',
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  console.log('  ✓ Subscription: active (mock)');

  console.log('\n✅ Reset complete!');
  console.log(`  Dashboard login: owner@demo.test`);
  console.log(`  Widget public key: ${publicKey}`);

  await pool.end();
}

main().catch((err) => {
  console.error('❌ Reset failed:', err);
  process.exit(1);
});
