import type { APIRoute } from 'astro';
import type { TelegramUpdate } from '../../../lib/telegram';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const env = locals.runtime.env;

  if (params.secret !== env.TG_WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  const update = await request.json() as TelegramUpdate;

  if (!update.message?.text) {
    return new Response('ok');
  }

  const text = update.message.text.trim();
  const chatId = String(update.message.chat.id);

  if (text.startsWith('/start')) {
    const token = text.split(' ')[1];

    if (!token) {
      await sendReply(env, chatId, 'Uzyj linku rejestracyjnego od administratora.');
      return new Response('ok');
    }

    const seller = await env.leadgen.prepare(
      'SELECT id, telegram_chat_id FROM sellers WHERE token = ?'
    ).bind(token).first<{ id: number; telegram_chat_id: string | null }>();

    if (!seller) {
      await sendReply(env, chatId, 'Nieprawidlowy token.');
      return new Response('ok');
    }

    if (seller.telegram_chat_id === chatId) {
      await sendReply(env, chatId, 'Juz jestes zarejestrowany.');
      return new Response('ok');
    }

    await env.leadgen.prepare(
      'UPDATE sellers SET telegram_chat_id = ? WHERE token = ?'
    ).bind(chatId, token).run();

    await sendReply(env, chatId, 'Zarejestrowano! Bedziesz otrzymywac codzienne raporty.');
    return new Response('ok');
  }

  return new Response('ok');
};

async function sendReply(env: Env, chatId: string, text: string): Promise<void> {
  const { sendMessage } = await import('../../../lib/telegram');
  await sendMessage(env, chatId, text);
}
