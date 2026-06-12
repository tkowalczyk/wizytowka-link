import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../test/seed";
import { startChatSession } from "./lib/chat";
import { loadSellerChatEvidence } from "./lib/seller-evidence";

const handleMock = vi.hoisted(() => vi.fn());

vi.mock("@astrojs/cloudflare/handler", () => ({
	handle: handleMock,
}));

import worker from "./worker";

function createExecutionContext() {
	const pending: Promise<unknown>[] = [];
	const ctx = {
		waitUntil(promise: Promise<unknown>) {
			pending.push(promise);
		},
		passThroughOnException() {},
	} as unknown as ExecutionContext;

	return {
		ctx,
		settle: () => Promise.allSettled(pending),
	};
}

function workerRequest(
	input: string,
	init?: RequestInit,
): Parameters<typeof worker.fetch>[0] {
	return new Request(input, init) as Parameters<typeof worker.fetch>[0];
}

describe("worker fetch analytics", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
		handleMock.mockReset();
		handleMock.mockResolvedValue(
			new Response("<html></html>", { status: 200 }),
		);
	});

	// Assumptions for issue #52:
	// Public page visits are counted per successful non-draft GET request, not per session.
	// The public page identity comes from /{localitySlug}/{businessSlug}.
	// Referrer and user agent are copied from request headers and may be null.
	// This iteration intentionally does not add bot filtering or cross-request deduplication.
	it("records a page_visit analytics event when a public business page is served", async () => {
		const { ctx, settle } = createExecutionContext();

		const response = await worker.fetch(
			workerRequest("https://wizytowka.link/warszawa/hydraulik-warszawa", {
				headers: {
					Referer: "https://example.test/source",
					"User-Agent": "Vitest Agent",
				},
			}),
			env,
			ctx,
		);
		await settle();

		expect(response.status).toBe(200);

		const row = await env.leadgen
			.prepare(
				`SELECT COUNT(*) AS count,
                MAX(referrer) AS referrer,
                MAX(user_agent) AS user_agent
         FROM analytics_events
         WHERE event_type = 'page_visit'
           AND locality_slug = 'warszawa'
           AND business_slug = 'hydraulik-warszawa'`,
			)
			.first<{
				count: number;
				referrer: string | null;
				user_agent: string | null;
			}>();

		expect(row).toEqual({
			count: 1,
			referrer: "https://example.test/source",
			user_agent: "Vitest Agent",
		});
	});

	it("feeds served public page visits into seller chat start rate", async () => {
		const { ctx, settle } = createExecutionContext();
		await worker.fetch(
			workerRequest("https://wizytowka.link/warszawa/hydraulik-warszawa", {
				headers: {
					Referer: "https://example.test/source",
					"User-Agent": "Vitest Agent",
				},
			}),
			env,
			ctx,
		);
		await settle();

		const chat = await startChatSession(
			env.leadgen,
			{ locSlug: "warszawa", businessSlug: "hydraulik-warszawa" },
			{
				referrer: "https://example.test/source",
				userAgent: "Vitest Agent",
				startedAt: "2026-05-26T10:00:00.000Z",
			},
		);
		if (!chat) throw new Error("failed to create test chat session");

		const evidence = await loadSellerChatEvidence(
			env.leadgen,
			"seller_jan_token",
			chat.sessionId,
		);

		expect(evidence?.metrics).toEqual(
			expect.objectContaining({
				pageVisits: 1,
				chatStarts: 1,
				chatStartRate: 1,
			}),
		);
	});
});

describe("worker trailing-slash redirect", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
		handleMock.mockReset();
		handleMock.mockResolvedValue(new Response(null, { status: 204 }));
	});

	it("redirects /path/ to /path with 301", async () => {
		const { ctx } = createExecutionContext();
		const res = await worker.fetch(
			workerRequest("https://wizytowka.link/lomianki/"),
			env,
			ctx,
		);

		expect(res.status).toBe(301);
		expect(res.headers.get("Location")).toBe("https://wizytowka.link/lomianki");
		expect(handleMock).not.toHaveBeenCalled();
	});

	it("redirects nested /loc/slug/ to /loc/slug", async () => {
		const { ctx } = createExecutionContext();
		const res = await worker.fetch(
			workerRequest("https://wizytowka.link/lomianki/some-business/"),
			env,
			ctx,
		);

		expect(res.status).toBe(301);
		expect(res.headers.get("Location")).toBe(
			"https://wizytowka.link/lomianki/some-business",
		);
		expect(handleMock).not.toHaveBeenCalled();
	});

	it("does NOT redirect root /", async () => {
		const { ctx } = createExecutionContext();
		const res = await worker.fetch(
			workerRequest("https://wizytowka.link/"),
			env,
			ctx,
		);

		expect(res.status).toBe(204);
		expect(handleMock).toHaveBeenCalledOnce();
	});

	it("does NOT redirect paths without trailing slash", async () => {
		const { ctx } = createExecutionContext();
		const res = await worker.fetch(
			workerRequest("https://wizytowka.link/lomianki"),
			env,
			ctx,
		);

		expect(res.status).toBe(204);
		expect(handleMock).toHaveBeenCalledOnce();
	});

	it("strips multiple trailing slashes", async () => {
		const { ctx } = createExecutionContext();
		const res = await worker.fetch(
			workerRequest("https://wizytowka.link/lomianki///"),
			env,
			ctx,
		);

		expect(res.status).toBe(301);
		expect(res.headers.get("Location")).toBe("https://wizytowka.link/lomianki");
		expect(handleMock).not.toHaveBeenCalled();
	});

	it("preserves query string", async () => {
		const { ctx } = createExecutionContext();
		const res = await worker.fetch(
			workerRequest("https://wizytowka.link/lomianki/?draft=1"),
			env,
			ctx,
		);

		expect(res.status).toBe(301);
		expect(res.headers.get("Location")).toBe(
			"https://wizytowka.link/lomianki?draft=1",
		);
		expect(handleMock).not.toHaveBeenCalled();
	});
});
