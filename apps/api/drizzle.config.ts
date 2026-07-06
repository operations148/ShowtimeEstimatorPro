import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/models/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? './dev.db',
  },
});
