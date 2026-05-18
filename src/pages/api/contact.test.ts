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

async function submitContact(request: Request): Promise<Response> {
	return POST({ request } as Parameters<typeof POST>[0]);
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
