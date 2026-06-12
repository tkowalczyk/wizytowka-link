import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applySchema, resetDb } from "./seed";

const migrationFiles = import.meta.glob("../migrations/*.sql", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

type SchemaRow = {
	type: string;
	name: string;
	sql: string | null;
};

const tables = [
	"chat_messages",
	"analytics_events",
	"chat_sessions",
	"alert_log",
	"draft_preview_tokens",
	"cron_log",
	"call_log",
	"business_owners",
	"businesses",
	"sellers",
	"localities",
] as const;

async function resetToEmptySchema(db: D1Database): Promise<void> {
	for (const table of tables) {
		await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
	}
}

function sqlStatements(sql: string): string[] {
	return sql
		.split(";")
		.map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
		.filter(Boolean);
}

async function applyMigrations(db: D1Database): Promise<void> {
	const orderedMigrations = Object.entries(migrationFiles).sort(([a], [b]) =>
		a.localeCompare(b),
	);

	for (const [, migrationSql] of orderedMigrations) {
		for (const statement of sqlStatements(migrationSql)) {
			await db.prepare(statement).run();
		}
	}
}

function normalizeSchemaRow(row: SchemaRow): SchemaRow {
	return {
		...row,
		sql: row.sql?.replace(/\s+/g, " ").trim() ?? null,
	};
}

async function readSchema(db: D1Database): Promise<SchemaRow[]> {
	const rows = await db
		.prepare(
			`
				SELECT type, name, sql
				FROM sqlite_master
				WHERE type IN ('table', 'index')
					AND name NOT LIKE 'sqlite_%'
					AND name NOT LIKE 'd1_%'
				ORDER BY type, name
			`,
		)
		.all<SchemaRow>();

	return rows.results.map(normalizeSchemaRow);
}

describe("test schema parity", () => {
	it("test schema matches the schema produced by migrations", async () => {
		// Assumptions encoded by this test:
		// - The production schema is every migrations/*.sql file, applied in filename order.
		// - Test schema parity is the normalized sqlite_master table/index definition set.
		// - sqlite_* and d1_* internal objects are intentionally excluded.
		// - Seed data contents are intentionally not tested here.
		await resetToEmptySchema(env.leadgen);
		await applyMigrations(env.leadgen);
		const migrationSchema = await readSchema(env.leadgen);

		await resetToEmptySchema(env.leadgen);
		await applySchema(env.leadgen);
		const seedSchema = await readSchema(env.leadgen);

		expect(seedSchema).toEqual(migrationSchema);
	});

	it("resetDb enforces the production owner chat uniqueness constraint", async () => {
		await resetDb(env.leadgen);

		await expect(
			env.leadgen
				.prepare(
					`
						INSERT INTO business_owners (business_id, chat_id, token)
						VALUES (?, ?, ?)
					`,
				)
				.bind(4, "200001", "duplicate_chat_token")
				.run(),
		).rejects.toThrow();
	});
});
