/**
 * Imports estimator questions from attachments/estimator-questions.sample.json
 * into an existing tenant's estimator.
 *
 * Usage: TENANT_ID=xxx ESTIMATOR_ID=xxx tsx scripts/import-estimator.ts
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../apps/api/src/models/schema';
import sampleQuestions from '../attachments/estimator-questions.sample.json';
import * as path from 'path';

const DB_PATH =
  process.env['DATABASE_URL'] ?? path.resolve(__dirname, '../apps/api/dev.db');

async function main() {
  const tenantId = process.env['TENANT_ID'];
  const estimatorId = process.env['ESTIMATOR_ID'];

  if (!tenantId || !estimatorId) {
    console.log('Usage: TENANT_ID=xxx ESTIMATOR_ID=xxx tsx scripts/import-estimator.ts');
    console.log('\nThis script imports the sample estimator questions into an existing estimator.');
    console.log('If you just want to seed a fresh database, use: tsx scripts/seed.ts');
    process.exit(0);
  }

  const sqlite = new Database(DB_PATH);
  const db = drizzle(sqlite, { schema });

  const questions = sampleQuestions.steps.map((step: any, idx: number) => ({
    id: step.id,
    stepId: step.id,
    type: step.type,
    label: step.id.replace(/_/g, ' '),
    options: step.options,
    required: true,
    order: idx,
  }));

  // Find current version
  const [estimator] = db
    .select()
    .from(schema.estimators)
    .where(eq(schema.estimators.id, estimatorId))
    .limit(1)
    .all();

  if (!estimator) {
    console.error(`Estimator ${estimatorId} not found.`);
    process.exit(1);
  }

  if (estimator.currentVersionId) {
    db.update(schema.estimatorVersions)
      .set({ questions })
      .where(eq(schema.estimatorVersions.id, estimator.currentVersionId))
      .run();
  } else {
    const [version] = db
      .insert(schema.estimatorVersions)
      .values({ estimatorId, version: 1, questions })
      .returning()
      .all();
    db.update(schema.estimators)
      .set({ currentVersionId: version!.id })
      .where(eq(schema.estimators.id, estimatorId))
      .run();
  }

  console.log(`✅ Imported ${questions.length} questions into estimator ${estimatorId}`);
  sqlite.close();
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
