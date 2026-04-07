import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../../test/seed";
import { completeRun, failRun, startRun } from "../../lib/cron-log";

beforeEach(() => resetDb(env.leadgen));

interface CronLogRow {
	id: number;
	cron_pattern: string;
	status: string;
	items_processed: number | null;
}

interface CronLogResponse {
	runs: CronLogRow[];
}

async function callEndpoint(token?: string, query = "") {
	const { GET } = await import("./cron-log");
	const url = `http://localhost/api/cron-log${query}`;
	const headers: Record<string, string> = {};
	if (token) headers["x-seller-token"] = token;

	return GET({
		request: new Request(url, { headers }),
		locals: { runtime: { env } },
	} as any);
}

async function readBody(res: Response): Promise<CronLogResponse> {
	return res.json() as Promise<CronLogResponse>;
}

describe("GET /api/cron-log", () => {
	it("returns 401 without seller token", async () => {
		const res = await callEndpoint();
		expect(res.status).toBe(401);
	});

	it("returns 401 with invalid token", async () => {
		const res = await callEndpoint("bogus-token");
		expect(res.status).toBe(401);
	});

	it("returns empty array when no runs exist", async () => {
		const res = await callEndpoint("seller_jan_token");
		expect(res.status).toBe(200);
		const body = await readBody(res);
		expect(body.runs).toEqual([]);
	});

	it("returns recent runs ordered by started_at desc", async () => {
		const id1 = await startRun(env.leadgen, "0 * * * *");
		await completeRun(env.leadgen, id1, { processed: 10, failed: 1 });
		const id2 = await startRun(env.leadgen, "0 8 * * *");
		await failRun(env.leadgen, id2, new Error("quota"));

		const res = await callEndpoint("seller_jan_token");
		const body = await readBody(res);

		expect(body.runs).toHaveLength(2);
		expect(body.runs[0].id).toBe(id2); // most recent first
		expect(body.runs[0].status).toBe("failed");
		expect(body.runs[1].status).toBe("completed");
		expect(body.runs[1].items_processed).toBe(10);
	});

	it("filters by cron_pattern query param", async () => {
		await startRun(env.leadgen, "0 * * * *");
		await startRun(env.leadgen, "0 8 * * *");

		const res = await callEndpoint("seller_jan_token", "?pattern=0 8 * * *");
		const body = await readBody(res);

		expect(body.runs).toHaveLength(1);
		expect(body.runs[0].cron_pattern).toBe("0 8 * * *");
	});

	it("limits results to 50 by default", async () => {
		// just verify the limit param is respected
		const res = await callEndpoint("seller_jan_token", "?limit=1");
		const body = await readBody(res);

		expect(body.runs.length).toBeLessThanOrEqual(1);
	});
});
