import { createBotRoute, createSellerStartHandler } from '../../../../lib/telegram/index';

export const { POST } = createBotRoute({
  secretEnvKey: 'TG_SELLER_WEBHOOK_SECRET',
  tokenEnvKey: 'TG_SELLER_BOT_TOKEN',
  handlers: [createSellerStartHandler('report_chat_id', 'Bedziesz otrzymywac codzienne raporty.')],
});
