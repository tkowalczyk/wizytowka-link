import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, TEST_IDS } from "../../../../test/seed";
import type { TelegramUpdate } from "../../telegram";
import type { TgContext } from "../types";
import { createSellerStartHandler } from "./registration";

// -- helpers --

function makeCtx(overrides: Partial<TgContext> = {}): TgContext {
	return {
		env,
		token: "test-token",
		chatId: "999",
		update: { update_id: 1 } as TelegramUpdate,
		reply: vi.fn(async () => {}),
		replyWithKeyboard: vi.fn(async () => {}),
		typing: vi.fn(async () => {}),
		...overrides,
	};
}

function msgUpdate(text: string): TelegramUpdate {
	return {
		update_id: 1,
		message: {
			message_id: 1,
			chat: { id: 999, type: "private" },
			text,
			date: 0,
		},
	};
}

describe("createSellerStartHandler (report_chat_id)", () => {
	const handler = createSellerStartHandler(
		"report_chat_id",
		"Bedziesz otrzymywac codzienne raporty.",
	);

	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	it("does not match non-/start messages", () => {
		const update = msgUpdate("hello");
		expect(handler.match(update, makeCtx())).toBe(false);
	});

	it("does not match /start without token", () => {
		const update = msgUpdate("/start");
		// matches but handle should reply with help
		expect(handler.match(update, makeCtx())).toBe(true);
	});

	it("replies with help when no token provided", async () => {
		const update = msgUpdate("/start");
		const ctx = makeCtx({ update });
		await handler.handle(ctx);
		expect(ctx.reply).toHaveBeenCalledWith(
			"Uzyj linku rejestracyjnego od administratora.",
		);
	});

	it("replies error for invalid token", async () => {
		const update = msgUpdate("/start invalid_token");
		const ctx = makeCtx({ update });
		await handler.handle(ctx);
		expect(ctx.reply).toHaveBeenCalledWith("Nieprawidlowy token.");
	});

	it("registers seller with valid token", async () => {
		const update = msgUpdate(`/start ${TEST_IDS.tokens.sellerAnna}`);
		const ctx = makeCtx({ chatId: "555", update });
		await handler.handle(ctx);

		expect(ctx.reply).toHaveBeenCalledWith(
			expect.stringContaining("Zarejestrowano"),
		);

		const seller = await env.leadgen
			.prepare("SELECT report_chat_id FROM sellers WHERE token = ?")
			.bind(TEST_IDS.tokens.sellerAnna)
			.first<{ report_chat_id: string }>();
		expect(seller?.report_chat_id).toBe("555");
	});

	it("replies idempotent when already registered with same chat", async () => {
		// seller_jan already has report_chat_id='100001'
		const update = msgUpdate(`/start ${TEST_IDS.tokens.sellerJan}`);
		const ctx = makeCtx({ chatId: "100001", update });
		await handler.handle(ctx);
		expect(ctx.reply).toHaveBeenCalledWith("Juz jestes zarejestrowany.");
	});
});

describe("createSellerStartHandler (notify_chat_id)", () => {
	const handler = createSellerStartHandler(
		"notify_chat_id",
		"Bedziesz otrzymywac powiadomienia o nowych kontaktach.",
	);

	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	it("registers seller notify_chat_id", async () => {
		// seller_anna has notify_chat_id='100002' in seed — use a new chat id
		const update = msgUpdate(`/start ${TEST_IDS.tokens.sellerJan}`);
		const ctx = makeCtx({ chatId: "777", update });
		await handler.handle(ctx);

		expect(ctx.reply).toHaveBeenCalledWith(
			expect.stringContaining("Zarejestrowano"),
		);

		const seller = await env.leadgen
			.prepare("SELECT notify_chat_id FROM sellers WHERE token = ?")
			.bind(TEST_IDS.tokens.sellerJan)
			.first<{ notify_chat_id: string }>();
		expect(seller?.notify_chat_id).toBe("777");
	});
});
