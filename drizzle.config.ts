import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.AI_TASKS_DB_PATH ?? './data/ai-tasks.sqlite' },
  strict: true,
  verbose: true,
});
