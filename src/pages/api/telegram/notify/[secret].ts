import {
	createBotRoute,
	createSellerStartHandler,
} from "../../../../lib/telegram/index";

export const { POST } = createBotRoute({
	secretEnvKey: "TG_NOTIFY_WEBHOOK_SECRET",
	tokenEnvKey: "TG_NOTIFY_BOT_TOKEN",
	handlers: [
		createSellerStartHandler(
			"notify_chat_id",
			"Bedziesz otrzymywac powiadomienia o nowych kontaktach.",
		),
	],
});
