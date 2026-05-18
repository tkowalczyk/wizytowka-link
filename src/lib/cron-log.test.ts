import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../test/seed";
import {
	completeRun,
	failRun,
	getCronSummary,
	type RunResult,
	startRun,
} from "./cron-log";

interface CronLogRow {
	id: number;
	cron_pattern: string;
	started_at: string;
	finished_at: string | null;
	items_processed: number;
	items_failed: number;
	status: string;
	error: string | null;
	meta: string | null;
}

beforeEach(() => resetDb(env.leadgen));

describe("cron-log", () => {
	it("startRun inserts a running row and returns its id", async () => {
		const id = await startRun(env.leadgen, "0 * * * *");

		const row = await env.leadgen
			.prepare("SELECT * FROM cron_log WHERE id = ?")
			.bind(id)
			.first<CronLogRow>();

		expect(row).toBeTruthy();
		expect(row?.cron_pattern).toBe("0 * * * *");
		expect(row?.status).toBe("running");
		expect(row?.finished_at).toBeNull();
		expect(row?.items_processed).toBe(0);
		expect(row?.items_failed).toBe(0);
	});

	it("completeRun sets status=completed with counts and finished_at", async () => {
		const id = await startRun(env.leadgen, "0 8 * * *");
		const result: RunResult = { processed: 10, failed: 2 };

		await completeRun(env.leadgen, id, result);

		const row = await env.leadgen
			.prepare("SELECT * FROM cron_log WHERE id = ?")
			.bind(id)
			.first<CronLogRow>();

		expect(row?.status).toBe("completed");
		expect(row?.items_processed).toBe(10);
		expect(row?.items_failed).toBe(2);
		expect(row?.finished_at).toBeTruthy();
		expect(row?.error).toBeNull();
	});

	it("failRun sets status=failed with error message", async () => {
		const id = await startRun(env.leadgen, "*/5 * * * *");

		await failRun(env.leadgen, id, new Error("something broke"));

		const row = await env.leadgen
			.prepare("SELECT * FROM cron_log WHERE id = ?")
			.bind(id)
			.first<CronLogRow>();

		expect(row?.status).toBe("failed");
		expect(row?.error).toBe("something broke");
		expect(row?.finished_at).toBeTruthy();
	});

	it("completeRun stores meta as JSON", async () => {
		const id = await startRun(env.leadgen, "0 8 * * *");
		const result: RunResult = {
			processed: 5,
			failed: 0,
			meta: { apiCalls: 12, quotaExhausted: false },
		};

		await completeRun(env.leadgen, id, result);

		const row = await env.leadgen
			.prepare("SELECT meta FROM cron_log WHERE id = ?")
			.bind(id)
			.first<{ meta: string }>();

		if (!row) throw new Error("Expected cron_log row");
		expect(JSON.parse(row.meta)).toEqual({
			apiCalls: 12,
			quotaExhausted: false,
		});
	});
});

describe("getCronSummary", () => {
	it("returns empty array when no runs exist", async () => {
		const summary = await getCronSummary(env.leadgen);
		expect(summary).toEqual([]);
	});

	it("aggregates runs by cron_pattern for last 24h", async () => {
		const id1 = await startRun(env.leadgen, "0 * * * *");
		await completeRun(env.leadgen, id1, { processed: 10, failed: 1 });

		const id2 = await startRun(env.leadgen, "0 * * * *");
		await completeRun(env.leadgen, id2, { processed: 20, failed: 3 });

		const id3 = await startRun(env.leadgen, "0 8 * * *");
		await failRun(env.leadgen, id3, new Error("boom"));

		const summary = await getCronSummary(env.leadgen);

		expect(summary).toHaveLength(2);

		const geocoder = summary.find((s) => s.cron_pattern === "0 * * * *");
		if (!geocoder) throw new Error("Expected geocoder summary");
		expect(geocoder.total_runs).toBe(2);
		expect(geocoder.completed).toBe(2);
		expect(geocoder.failed).toBe(0);
		expect(geocoder.total_processed).toBe(30);
		expect(geocoder.total_failed_items).toBe(4);

		const discovery = summary.find((s) => s.cron_pattern === "0 8 * * *");
		if (!discovery) throw new Error("Expected discovery summary");
		expect(discovery.total_runs).toBe(1);
		expect(discovery.failed).toBe(1);
	});

	it("excludes runs older than 24h", async () => {
		// Insert a run with started_at in the past
		await env.leadgen
			.prepare(
				"INSERT INTO cron_log (cron_pattern, started_at, status, items_processed) VALUES ('0 * * * *', datetime('now', '-2 days'), 'completed', 50)",
			)
			.run();

		const summary = await getCronSummary(env.leadgen);
		expect(summary).toEqual([]);
	});
});
