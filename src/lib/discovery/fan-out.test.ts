import { describe, expect, it, vi } from "vitest";
import type { SellerRow } from "../../types/business";
import type { DailyReportStats } from "../telegram";
import { fanOutDailyReports } from "./index";

function makeSeller(id: number, overrides: Partial<SellerRow> = {}): SellerRow {
	return {
		id,
		name: `Seller ${id}`,
		notify_chat_id: null,
		report_chat_id: `chat_${id}`,
		token: `tok_${id}`,
		created_at: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

function makeStats(): DailyReportStats {
	return {
		locality_name: "Kraków",
		total_businesses: 0,
		new_leads: 0,
		top_leads: [],
	};
}

describe("fanOutDailyReports", () => {
	it("tracer: calls send once per seller", async () => {
		const received: number[] = [];
		const send = vi.fn(async (_token: string, seller: SellerRow) => {
			received.push(seller.id);
		});

		await fanOutDailyReports(
			"BOT_TOKEN",
			[makeSeller(1), makeSeller(2)],
			makeStats(),
			send,
		);

		expect(send).toHaveBeenCalledTimes(2);
		expect(received.sort()).toEqual([1, 2]);
	});

	it("one rejection does not prevent other sends; logs seller id", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const succeeded: number[] = [];
		const send = vi.fn(async (_token: string, seller: SellerRow) => {
			if (seller.id === 7) {
				throw new Error("boom");
			}
			succeeded.push(seller.id);
		});

		await fanOutDailyReports(
			"BOT_TOKEN",
			[makeSeller(7), makeSeller(8), makeSeller(9)],
			makeStats(),
			send,
		);

		expect(send).toHaveBeenCalledTimes(3);
		expect(succeeded.sort()).toEqual([8, 9]);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("telegram: failed for seller 7:"),
		);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("boom"));

		logSpy.mockRestore();
	});

	it("slow seller does not block fast seller", async () => {
		const finished: number[] = [];
		const send = async (_token: string, seller: SellerRow) => {
			if (seller.id === 1) {
				// slow
				await new Promise((r) => setTimeout(r, 50));
			}
			finished.push(seller.id);
		};

		await fanOutDailyReports(
			"BOT_TOKEN",
			[makeSeller(1), makeSeller(2)],
			makeStats(),
			send,
		);

		// fast (id=2) finishes before slow (id=1)
		expect(finished).toEqual([2, 1]);
	});
});
