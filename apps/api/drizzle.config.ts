import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/models/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Use the direct connection for schema introspection / push.
    url: process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'] ?? '',
  },
});
