import { describe, expect, it, vi } from "vitest";
import type { TelegramUpdate } from "../telegram";
import { createBotRoute } from "./dispatch";
import type { BotConfig, TgHandler } from "./types";

// -- helpers --

const fakeEnv = {
	TG_TEST_SECRET: "test-secret-value",
	TG_TEST_TOKEN: "test-token",
} as unknown as Env;

function makeUpdate(overrides: Partial<TelegramUpdate> = {}): TelegramUpdate {
	return {
		update_id: 1,
		message: {
			message_id: 1,
			chat: { id: 42, type: "private" },
			text: "hello",
			date: 0,
		},
		...overrides,
	};
}

function makeRequest(update: TelegramUpdate): Request {
	return new Request("http://test/api/telegram/bot/the-secret", {
		method: "POST",
		body: JSON.stringify(update),
		headers: { "Content-Type": "application/json" },
	});
}

function callRoute(
	config: BotConfig,
	secret: string,
	update: TelegramUpdate,
	envOverride = fakeEnv,
) {
	const { POST } = createBotRoute(config, envOverride);
	return POST({
		params: { secret },
		request: makeRequest(update),
	} as unknown as Parameters<typeof POST>[0]);
}

const baseConfig: BotConfig = {
	secretEnvKey: "TG_TEST_SECRET",
	tokenEnvKey: "TG_TEST_TOKEN",
	handlers: [],
};

// -- tests --

describe("createBotRoute", () => {
	it("returns 403 for wrong secret", async () => {
		const res = await callRoute(baseConfig, "wrong-secret", makeUpdate());
		expect(res.status).toBe(403);
	});

	it("returns 200 noop when no handlers match", async () => {
		const res = await callRoute(baseConfig, "test-secret-value", makeUpdate());
		expect(res.status).toBe(200);
	});

	it("returns 200 noop for update with no chat id", async () => {
		const update: TelegramUpdate = { update_id: 1 };
		const res = await callRoute(baseConfig, "test-secret-value", update);
		expect(res.status).toBe(200);
	});

	it("dispatches to first matching handler", async () => {
		const handled: string[] = [];
		const h1: TgHandler = {
			match: () => true,
			handle: async () => {
				handled.push("h1");
			},
		};
		const h2: TgHandler = {
			match: () => true,
			handle: async () => {
				handled.push("h2");
			},
		};

		const config: BotConfig = { ...baseConfig, handlers: [h1, h2] };
		await callRoute(config, "test-secret-value", makeUpdate());

		expect(handled).toEqual(["h1"]);
	});

	it("catches handler errors and replies with fallback", async () => {
		const failing: TgHandler = {
			match: () => true,
			handle: async () => {
				throw new Error("boom");
			},
		};

		const origFetch = globalThis.fetch;
		globalThis.fetch = vi.fn(
			async () => new Response(JSON.stringify({ ok: true })),
		);

		try {
			const config: BotConfig = { ...baseConfig, handlers: [failing] };
			const res = await callRoute(config, "test-secret-value", makeUpdate());
			expect(res.status).toBe(200);

			const calls = (
				globalThis.fetch as unknown as {
					mock: { calls: [string, RequestInit?][] };
				}
			).mock.calls;
			const sendCall = calls.find((c) => c[0]?.includes?.("/sendMessage"));
			expect(sendCall).toBeTruthy();
			if (!sendCall) throw new Error("Expected sendMessage call");
			const requestInit = sendCall[1];
			if (typeof requestInit?.body !== "string") {
				throw new Error("Expected sendMessage body");
			}
			const body = JSON.parse(requestInit.body);
			expect(body.text).toContain("blad");
		} finally {
			globalThis.fetch = origFetch;
		}
	});
});
