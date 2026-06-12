import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { timingSafeCompare } from "../auth";
import {
	sendChatAction,
	sendMessage,
	sendMessageWithKeyboard,
} from "../telegram";
import type {
	BotConfig,
	InlineKeyboardButton,
	TelegramUpdate,
	TgContext,
} from "./types";

function extractChatId(update: unknown): string | null {
	if (!update || typeof update !== "object") return null;

	const maybeUpdate = update as Partial<TelegramUpdate>;
	const callbackFromId = maybeUpdate.callback_query?.from?.id;
	if (callbackFromId != null) return String(callbackFromId);

	const messageChatId = maybeUpdate.message?.chat?.id;
	if (messageChatId != null) return String(messageChatId);

	return null;
}

function buildContext(
	env: Env,
	token: string,
	chatId: string,
	update: TelegramUpdate,
): TgContext {
	return {
		env,
		token,
		chatId,
		update,
		reply: (text: string) => sendMessage(token, chatId, text).then(() => {}),
		replyWithKeyboard: (text: string, keyboard: InlineKeyboardButton[][]) =>
			sendMessageWithKeyboard(token, chatId, text, keyboard),
		typing: () => sendChatAction(token, chatId),
	};
}

export function createBotRoute(
	config: BotConfig,
	routeEnv: Env = runtimeEnv,
): { POST: APIRoute } {
	const POST: APIRoute = async ({ params, request }) => {
		const env = routeEnv;
		const values = env as unknown as Record<string, string>;
		const secret = values[config.secretEnvKey];

		if (!(await timingSafeCompare(params.secret, secret))) {
			return new Response("forbidden", { status: 403 });
		}

		const token = values[config.tokenEnvKey];
		let update: unknown;
		try {
			update = await request.json();
		} catch {
			return new Response("ok");
		}
		const chatId = extractChatId(update);

		if (!chatId) return new Response("ok");

		const ctx = buildContext(env, token, chatId, update as TelegramUpdate);

		for (const handler of config.handlers) {
			let matches = false;
			try {
				matches = handler.match(update as TelegramUpdate, ctx);
			} catch (err) {
				console.error("telegram handler match error:", err);
				continue;
			}

			if (matches) {
				try {
					await handler.handle(ctx);
				} catch (err) {
					console.error("telegram handler error:", err);
					await ctx.reply("Wystapil blad. Sprobuj ponownie.").catch(() => {});
				}
				return new Response("ok");
			}
		}

		return new Response("ok");
	};

	return { POST };
}
