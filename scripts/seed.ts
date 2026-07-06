/**
 * Seed script — creates a demo tenant, owner user, sample estimator,
 * pricing config, and service area.
 *
 * Usage: tsx scripts/seed.ts  (from workspace root)
 * Or:    pnpm --filter api db:seed
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../apps/api/src/models/schema';
import sampleQuestions from '../attachments/estimator-questions.sample.json';
import samplePricing from '../attachments/pricing-config.sample.json';
import * as fs from 'fs';
import * as path from 'path';

const DB_PATH =
  process.env['DATABASE_URL'] ?? path.resolve(__dirname, '../apps/api/dev.db');

async function main() {
  const sqlite = new Database(DB_PATH);
  const db = drizzle(sqlite, { schema });

  console.log('🌱 Seeding database...');

  // 1. Create demo tenant
  const [tenant] = db
    .insert(schema.tenants)
    .values({
      slug: 'demo-pools',
      name: 'Demo Pool Company',
      notificationRecipients: ['owner@demo.test'],
      serviceAreaBehavior: 'block',
    })
    .returning()
    .all();

  console.log(`  ✓ Tenant: ${tenant!.name} (${tenant!.id})`);

  // 2. Create owner user
  const [owner] = db
    .insert(schema.users)
    .values({
      tenantId: tenant!.id,
      email: 'owner@demo.test',
      name: 'Demo Owner',
      role: 'owner',
    })
    .returning()
    .all();

  console.log(`  ✓ Owner: ${owner!.email} (${owner!.id})`);

  // 3. Create estimator
  // Fixed key so the marketing home (apps/widget/index.html) embeds a live demo
  // that works immediately after seeding.
  const publicKey = '26920aadc92ed1e98a274fdae4258cc7';
  const [estimator] = db
    .insert(schema.estimators)
    .values({
      tenantId: tenant!.id,
      publicKey,
      title: sampleQuestions.title,
      status: 'published',
      branding: { primaryColor: '#2563eb' },
    })
    .returning()
    .all();

  console.log(`  ✓ Estimator: ${estimator!.title} (key: ${publicKey})`);

  // 4. Create version with questions
  const questions = sampleQuestions.steps.map((step: any, idx: number) => ({
    id: step.id,
    stepId: step.id,
    type: step.type,
    label: step.label ?? step.id.replace(/_/g, ' '),
    options: step.options,
    required: true,
    order: idx,
  }));

  const [version] = db
    .insert(schema.estimatorVersions)
    .values({
      estimatorId: estimator!.id,
      version: 1,
      questions,
    })
    .returning()
    .all();

  db.update(schema.estimators)
    .set({ currentVersionId: version!.id })
    .where(eq(schema.estimators.id, estimator!.id))
    .run();

  console.log(`  ✓ Version 1: ${questions.length} question(s) linked (${version!.id})`);

  // 5. Import pricing config
  db.insert(schema.pricingConfigs)
    .values({
      tenantId: tenant!.id,
      estimatorId: estimator!.id,
      config: samplePricing,
    })
    .run();

  console.log('  ✓ Pricing config imported');

  // 6. Import service area
  const csvPath = path.resolve(__dirname, '../attachments/service-area.sample.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const zips = csvContent
    .split('\n')
    .map((line) => line.trim().replace(/\r/g, ''))
    .filter((line) => line && line !== 'zip');

  if (zips.length > 0) {
    db.insert(schema.serviceAreas)
      .values(zips.map((zip) => ({ tenantId: tenant!.id, zip })))
      .run();
  }

  console.log(`  ✓ Service area: ${zips.length} zip codes`);

  // 7. Create mock subscription
  db.insert(schema.subscriptions)
    .values({
      tenantId: tenant!.id,
      externalId: 'mock_sub_seed',
      status: 'active',
      planId: 'estimator_pro',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    .run();

  console.log('  ✓ Subscription: active (mock)');

  console.log('\n✅ Seed complete!');
  console.log(`\n  Dashboard login: owner@demo.test`);
  console.log(`  Widget public key: ${publicKey}`);
  console.log(
    `  Widget embed:\n    <div id="estimator-widget" data-key="${publicKey}" data-api-url="http://localhost:4000/api/v1"></div>`,
  );
  console.log(`    <script src="http://localhost:5173/widget.iife.js"></script>\n`);

  sqlite.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
