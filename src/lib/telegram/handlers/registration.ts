import type { TgHandler } from "../types";

export function createSellerStartHandler(
	column: "report_chat_id" | "notify_chat_id",
	successMsg: string,
): TgHandler {
	return {
		match: (update) => !!update.message?.text?.startsWith("/start"),

		handle: async (ctx) => {
			const text = ctx.update.message?.text?.trim();
			if (!text) return;
			const sellerToken = text.split(" ")[1];

			if (!sellerToken) {
				await ctx.reply("Uzyj linku rejestracyjnego od administratora.");
				return;
			}

			const seller = await ctx.env.leadgen
				.prepare(`SELECT id, ${column} FROM sellers WHERE token = ?`)
				.bind(sellerToken)
				.first<{ id: number; [k: string]: unknown }>();

			if (!seller) {
				await ctx.reply("Nieprawidlowy token.");
				return;
			}

			if (seller[column] === ctx.chatId) {
				await ctx.reply("Juz jestes zarejestrowany.");
				return;
			}

			await ctx.env.leadgen
				.prepare(`UPDATE sellers SET ${column} = ? WHERE token = ?`)
				.bind(ctx.chatId, sellerToken)
				.run();

			await ctx.reply(`Zarejestrowano! ${successMsg}`);
		},
	};
}
