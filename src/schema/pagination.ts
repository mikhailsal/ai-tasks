import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Private database metadata, initialized by migration and never returned by queries.
// Retaining the key across connections permits CLI/API cursor continuation.
export const paginationSecrets = sqliteTable(
  'pagination_secrets',
  {
    id: integer('id').primaryKey().default(1),
    secret: text('secret').notNull(),
  },
  (table) => [
    check('pagination_secret_singleton', sql`${table.id} = 1`),
    check(
      'pagination_secret_hex256',
      sql`typeof(${table.secret}) = 'text' AND instr(${table.secret}, char(0)) = 0
        AND length(${table.secret}) = 64 AND ${table.secret} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);
