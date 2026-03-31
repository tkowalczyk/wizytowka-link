import { createBotRoute, draftCallbackHandler, startLinkHandler, ownerEditHandler } from '../../../../lib/telegram/index';

export const { POST } = createBotRoute({
  secretEnvKey: 'TG_CLIENT_WEBHOOK_SECRET',
  tokenEnvKey: 'TG_CLIENT_BOT_TOKEN',
  handlers: [draftCallbackHandler, startLinkHandler, ownerEditHandler],
});
