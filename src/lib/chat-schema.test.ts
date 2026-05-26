import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../test/seed";

async function tableColumns(table: string): Promise<string[]> {
	const result = await env.leadgen
		.prepare(`PRAGMA table_info(${table})`)
		.all<{ name: string }>();
	return result.results.map((column) => column.name);
}

describe("chat session schema", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	// Assumptions for issue #44:
	// The D1 schema is the public persistence contract for later chat phases.
	// Start/end Telegram markers are nullable timestamp columns.
	// Message persistence is intentionally not part of this phase.
	it("includes the minimum lifecycle fields for chat sessions and analytics", async () => {
		await expect(tableColumns("chat_sessions")).resolves.toEqual(
			expect.arrayContaining([
				"id",
				"business_id",
				"locality_slug",
				"business_slug",
				"started_at",
				"ended_at",
				"status",
				"referrer",
				"user_agent",
				"end_reason",
				"telegram_start_sent_at",
				"telegram_end_sent_at",
				"message_count",
				"intent_summary",
				"intent_categories",
				"has_complaint",
				"has_commercial_demand",
			]),
		);

		await expect(tableColumns("analytics_events")).resolves.toEqual(
			expect.arrayContaining([
				"id",
				"event_type",
				"locality_slug",
				"business_slug",
				"session_id",
				"occurred_at",
				"referrer",
				"user_agent",
			]),
		);
	});

	// Assumptions for issue #45:
	// The transcript persistence contract is one append-only row per chat turn.
	// Roles are stored as visitor/assistant because those are the public chat actors.
	// Chronological rendering can sort by message_index first and created_at as the timestamp.
	it("includes transcript fields for persisted visitor and assistant messages", async () => {
		await expect(tableColumns("chat_messages")).resolves.toEqual(
			expect.arrayContaining([
				"id",
				"session_id",
				"locality_slug",
				"business_slug",
				"role",
				"content",
				"message_index",
				"created_at",
			]),
		);
	});
});
