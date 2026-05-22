import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../../../../../test/seed";

async function callEndpoint(opts: { name: string; token?: string }) {
	const { POST } = await import("./[name]");
	const headers: Record<string, string> = {};
	if (opts.token !== undefined) headers["x-admin-token"] = opts.token;
	return POST({
		params: { name: opts.name },
		request: new Request("http://localhost/api/admin/run-cron/preflight", {
			method: "POST",
			headers,
		}),
		locals: {
			cfContext: {
				waitUntil: () => {},
				passThroughOnException: () => {},
			},
		},
	} as unknown as Parameters<typeof POST>[0]);
}

describe("POST /api/admin/run-cron/[name]", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
	});
	afterEach(() => vi.unstubAllGlobals());

	it("returns 401 when x-admin-token is wrong", async () => {
		const res = await callEndpoint({
			name: "preflight",
			token: "wrong-token",
		});
		expect(res.status).toBe(401);
	});

	it("returns 200 with run result when token matches", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							plan_id: "developer",
							plan_searches_left: 5000,
							total_searches_left: 5000,
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					),
			),
		);

		const res = await callEndpoint({
			name: "preflight",
			token: "test-admin-token",
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			name: string;
			cron: string;
			result: { processed: number; failed: number; meta: { skip: boolean } };
		};
		expect(body.name).toBe("preflight");
		expect(body.result.meta.skip).toBe(false);
	});
});
