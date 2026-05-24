import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../../../test/seed";
import { POST } from "./contact";

function contactRequest(phone: string, ip = "203.0.113.10"): Request {
	return new Request("https://wizytowka.link/api/contact", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"CF-Connecting-IP": ip,
		},
		body: JSON.stringify({ phone, token: "valid-turnstile-token" }),
	});
}

function mockFetch() {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = input.toString();
		if (url.includes("challenges.cloudflare.com/turnstile")) {
			return Response.json({ success: true });
		}
		if (url.includes("api.telegram.org")) {
			return Response.json({
				ok: true,
				result: { message_id: 1, chat: { id: 1, type: "private" }, date: 0 },
			});
		}
		throw new Error(`Unexpected fetch: ${url} ${String(init?.body ?? "")}`);
	});
}

function telegramCalls(fetchMock: ReturnType<typeof mockFetch>) {
	return fetchMock.mock.calls.filter(([input]) =>
		input.toString().includes("api.telegram.org"),
	);
}

function createCfContext() {
	const pending: Promise<unknown>[] = [];
	return {
		locals: {
			cfContext: {
				waitUntil: (p: Promise<unknown>) => {
					pending.push(p);
				},
				passThroughOnException: () => {},
			},
		},
		pending,
		settle: () => Promise.allSettled(pending),
	};
}

async function submitContact(request: Request): Promise<Response> {
	const ctx = createCfContext();
	const response = await POST({
		request,
		locals: ctx.locals,
	} as Parameters<typeof POST>[0]);
	await ctx.settle();
	return response;
}

async function clearContactRateLimitState(): Promise<void> {
	const listed = await env.STATE.list({ prefix: "contact:v1:" });
	await Promise.all(listed.keys.map((key) => env.STATE.delete(key.name)));
}

describe("POST /api/contact", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
		await clearContactRateLimitState();
	});

	it("sends seller notifications for a valid matching phone submission", async () => {
		const fetchMock = mockFetch();
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const response = await submitContact(contactRequest("+48 123 456 789"));

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ ok: true });

			const calls = telegramCalls(fetchMock);
			expect(calls).toHaveLength(2);
			const bodies = calls.map(([, init]) => JSON.parse(init?.body as string));
			expect(bodies.map((body) => body.chat_id).sort()).toEqual([
				"100001",
				"100002",
			]);
			expect(bodies[0].text).toContain("Hydraulik Warszawa");
			expect(bodies[0].text).toContain("biz_hydraulik_token");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("throttles a repeated valid submission for the same phone and IP before side effects", async () => {
		const fetchMock = mockFetch();
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const first = await submitContact(contactRequest("+48 111 222 333"));
			expect(first.status).toBe(200);
			expect(telegramCalls(fetchMock)).toHaveLength(2);

			await env.leadgen
				.prepare("DELETE FROM business_owners WHERE business_id = 3")
				.run();

			const second = await submitContact(contactRequest("+48 111 222 333"));

			expect(second.status).toBe(429);
			expect(await second.json()).toEqual({ error: "za duzo prob" });
			expect(telegramCalls(fetchMock)).toHaveLength(2);

			const owner = await env.leadgen
				.prepare("SELECT token FROM business_owners WHERE business_id = 3")
				.first<{ token: string }>();
			expect(owner).toBeNull();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("returns the response before the Telegram fan-out completes", async () => {
		let releaseTelegram!: () => void;
		const telegramGate = new Promise<void>((resolve) => {
			releaseTelegram = resolve;
		});
		let telegramCompleted = 0;

		const fetchMock = vi.fn(
			async (input: RequestInfo | URL, _init?: RequestInit) => {
				const url = input.toString();
				if (url.includes("challenges.cloudflare.com/turnstile")) {
					return Response.json({ success: true });
				}
				if (url.includes("api.telegram.org")) {
					await telegramGate;
					telegramCompleted++;
					return Response.json({
						ok: true,
						result: {
							message_id: 1,
							chat: { id: 1, type: "private" },
							date: 0,
						},
					});
				}
				throw new Error(`Unexpected fetch: ${url}`);
			},
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const ctx = createCfContext();
			const responsePromise = Promise.resolve(
				POST({
					request: contactRequest("+48 123 456 789"),
					locals: ctx.locals,
				} as Parameters<typeof POST>[0]),
			);

			const winner = await Promise.race([
				responsePromise.then(() => "response" as const),
				new Promise<"timeout">((resolve) =>
					setTimeout(() => resolve("timeout"), 200),
				),
			]);
			expect(winner).toBe("response");

			const response = await responsePromise;
			expect(response.status).toBe(200);
			expect(telegramCompleted).toBe(0);

			releaseTelegram();
			await ctx.settle();
			expect(telegramCompleted).toBe(2);
		} finally {
			releaseTelegram?.();
			globalThis.fetch = originalFetch;
		}
	});

	it("isolates Telegram send failures so one rejection does not poison the fan-out", async () => {
		const fetchMock = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = input.toString();
				if (url.includes("challenges.cloudflare.com/turnstile")) {
					return Response.json({ success: true });
				}
				if (url.includes("api.telegram.org")) {
					const body = JSON.parse((init?.body ?? "{}") as string) as {
						chat_id: string;
					};
					if (body.chat_id === "100001") {
						throw new Error("simulated transport failure");
					}
					return Response.json({
						ok: true,
						result: {
							message_id: 1,
							chat: { id: 1, type: "private" },
							date: 0,
						},
					});
				}
				throw new Error(`Unexpected fetch: ${url}`);
			},
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const ctx = createCfContext();
			const response = await POST({
				request: contactRequest("+48 123 456 789"),
				locals: ctx.locals,
			} as Parameters<typeof POST>[0]);

			expect(response.status).toBe(200);
			expect(ctx.pending).toHaveLength(1);

			const outcome = await ctx.pending[0].then(
				() => "fulfilled" as const,
				() => "rejected" as const,
			);
			expect(outcome).toBe("fulfilled");

			expect(telegramCalls(fetchMock)).toHaveLength(2);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("allows a different phone from the same IP within the cooldown", async () => {
		const fetchMock = mockFetch();
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const first = await submitContact(contactRequest("+48 111 222 333"));
			expect(first.status).toBe(200);

			const second = await submitContact(contactRequest("+48 777 888 999"));
			expect(second.status).toBe(200);
			expect(telegramCalls(fetchMock)).toHaveLength(4);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
