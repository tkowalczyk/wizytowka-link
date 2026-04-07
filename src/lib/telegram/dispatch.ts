import type { APIRoute } from "astro";
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

function extractChatId(update: TelegramUpdate): string | null {
	if (update.callback_query) return String(update.callback_query.from.id);
	if (update.message) return String(update.message.chat.id);
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

export function createBotRoute(config: BotConfig): { POST: APIRoute } {
	const POST: APIRoute = async ({ params, request, locals }) => {
		const env = locals.runtime.env;
		const secret = (env as Record<string, string>)[config.secretEnvKey];

		if (params.secret !== secret) {
			return new Response("forbidden", { status: 403 });
		}

		const token = (env as Record<string, string>)[config.tokenEnvKey];
		const update = (await request.json()) as TelegramUpdate;
		const chatId = extractChatId(update);

		if (!chatId) return new Response("ok");

		const ctx = buildContext(env, token, chatId, update);

		for (const handler of config.handlers) {
			if (handler.match(update, ctx)) {
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
