import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const workspaces=sqliteTable('workspaces',{key:text('key').primaryKey(),payload:text('payload').notNull(),revision:integer('revision').notNull().default(1),updatedAt:integer('updated_at').notNull()});
