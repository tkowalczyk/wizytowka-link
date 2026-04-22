import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, TEST_IDS } from "../../test/seed";
import {
	type FunnelStats,
	formatFunnelReport,
	getFunnelStats,
	getWeekOverWeekDelta,
	runFunnelReport,
} from "./funnel";
import * as telegram from "./telegram";

beforeEach(() => resetDb(env.leadgen));

describe("getFunnelStats", () => {
	it("counts latest status per business grouped by status", async () => {
		// Seed has: biz 1 → seller 1: called then interested (latest = interested)
		//           biz 3 → seller 1: called (latest = called)
		// So seller 1 should have: interested=1, called=1, total=2

		const stats = await getFunnelStats(env.leadgen, TEST_IDS.sellers.jan);

		expect(stats.total).toBe(2);
		expect(stats.counts.interested).toBe(1);
		expect(stats.counts.called).toBe(1);
		expect(stats.counts.pending).toBe(0);
		expect(stats.counts.rejected).toBe(0);
		expect(stats.counts.no_answer).toBe(0);
		expect(stats.counts.meeting_set).toBe(0);
		expect(stats.counts.deal_closed).toBe(0);
	});

	it("returns all 7 statuses even when some are zero", async () => {
		const stats = await getFunnelStats(env.leadgen, TEST_IDS.sellers.anna);

		// Anna has: biz 2 → rejected (1 entry)
		expect(stats.total).toBe(1);
		expect(stats.counts.rejected).toBe(1);
		expect(Object.keys(stats.counts)).toHaveLength(7);
	});

	it("returns zero counts for seller with no call_log entries", async () => {
		// Insert a seller with no call_log
		await env.leadgen
			.prepare(
				"INSERT INTO sellers (id, name, token) VALUES (99, 'Empty', 'empty_token')",
			)
			.run();

		const stats = await getFunnelStats(env.leadgen, 99);

		expect(stats.total).toBe(0);
		expect(stats.counts.pending).toBe(0);
		expect(stats.counts.called).toBe(0);
		expect(stats.counts.interested).toBe(0);
		expect(stats.counts.rejected).toBe(0);
		expect(stats.counts.no_answer).toBe(0);
		expect(stats.counts.meeting_set).toBe(0);
		expect(stats.counts.deal_closed).toBe(0);
	});
});

describe("getWeekOverWeekDelta", () => {
	it("calculates delta between current and previous week", async () => {
		const db = env.leadgen;
		const sellerId = TEST_IDS.sellers.jan;

		// Clear existing call_log and insert controlled data
		await db.prepare("DELETE FROM call_log").run();

		// Previous week: 2 called, 1 interested
		await db
			.prepare(
				"INSERT INTO call_log (business_id, seller_id, status, created_at) VALUES (?, ?, ?, datetime('now', '-10 days'))",
			)
			.bind(1, sellerId, "called")
			.run();
		await db
			.prepare(
				"INSERT INTO call_log (business_id, seller_id, status, created_at) VALUES (?, ?, ?, datetime('now', '-9 days'))",
			)
			.bind(3, sellerId, "called")
			.run();
		await db
			.prepare(
				"INSERT INTO call_log (business_id, seller_id, status, created_at) VALUES (?, ?, ?, datetime('now', '-8 days'))",
			)
			.bind(4, sellerId, "interested")
			.run();

		// Current week: 1 called, 2 interested, 1 deal_closed
		await db
			.prepare(
				"INSERT INTO call_log (business_id, seller_id, status, created_at) VALUES (?, ?, ?, datetime('now', '-2 days'))",
			)
			.bind(1, sellerId, "called")
			.run();
		await db
			.prepare(
				"INSERT INTO call_log (business_id, seller_id, status, created_at) VALUES (?, ?, ?, datetime('now', '-1 days'))",
			)
			.bind(3, sellerId, "interested")
			.run();
		await db
			.prepare(
				"INSERT INTO call_log (business_id, seller_id, status, created_at) VALUES (?, ?, ?, datetime('now', '-1 days'))",
			)
			.bind(4, sellerId, "interested")
			.run();
		await db
			.prepare(
				"INSERT INTO call_log (business_id, seller_id, status, created_at) VALUES (?, ?, ?, datetime('now', '-1 hours'))",
			)
			.bind(6, sellerId, "deal_closed")
			.run();

		const delta = await getWeekOverWeekDelta(db, sellerId);

		// Current: called=1, interested=2, deal_closed=1 (total=4)
		// Previous: called=2, interested=1 (total=3)
		// Delta: called=-1, interested=+1, deal_closed=+1
		expect(delta.called).toBe(-1);
		expect(delta.interested).toBe(1);
		expect(delta.deal_closed).toBe(1);
		expect(delta.pending).toBe(0);
	});
});

describe("formatFunnelReport", () => {
	it("includes all 7 statuses, total, and deltas in HTML", () => {
		const stats: FunnelStats = {
			total: 15,
			counts: {
				pending: 5,
				called: 3,
				interested: 2,
				rejected: 1,
				no_answer: 2,
				meeting_set: 1,
				deal_closed: 1,
			},
		};
		const delta = {
			pending: 2,
			called: -1,
			interested: 1,
			rejected: 0,
			no_answer: 0,
			meeting_set: 1,
			deal_closed: 0,
		};

		const html = formatFunnelReport(stats, delta, "tok123", "2026-04-20");

		// Contains header with date
		expect(html).toContain("2026-04-20");
		// Contains total
		expect(html).toContain("15");
		// Contains panel link
		expect(html).toContain("wizytowka.link/s/tok123");
		// Contains positive deltas with +
		expect(html).toContain("+2");
		expect(html).toContain("+1");
		// Contains negative delta
		expect(html).toContain("-1");
		// Does not show delta for zero-change statuses
		expect(html).not.toMatch(/rejected.*[+-]\d/);
	});
});

describe("runFunnelReport", () => {
	it("sends report to sellers with report_chat_id and skips others", async () => {
		const sendSpy = vi
			.spyOn(telegram, "sendMessage")
			.mockResolvedValue({ ok: true });

		const result = await runFunnelReport({
			leadgen: env.leadgen,
			TG_SELLER_BOT_TOKEN: "fake-token",
		} as unknown as Env);

		// Seller Jan has report_chat_id="100001", Anna has null
		expect(result.processed).toBe(1);
		expect(result.failed).toBe(0);
		expect(sendSpy).toHaveBeenCalledTimes(1);
		expect(sendSpy).toHaveBeenCalledWith(
			"fake-token",
			"100001",
			expect.stringContaining("Raport tygodniowy"),
		);

		sendSpy.mockRestore();
	});

	it("returns failed count when sendMessage throws", async () => {
		const sendSpy = vi
			.spyOn(telegram, "sendMessage")
			.mockRejectedValue(new Error("network"));

		const result = await runFunnelReport({
			leadgen: env.leadgen,
			TG_SELLER_BOT_TOKEN: "fake-token",
		} as unknown as Env);

		expect(result.processed).toBe(0);
		expect(result.failed).toBe(1);

		sendSpy.mockRestore();
	});
});
