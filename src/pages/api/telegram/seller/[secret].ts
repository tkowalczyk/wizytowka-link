import type { APIRoute } from 'astro';
import type { TelegramUpdate } from '../../../../lib/telegram';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const env = locals.runtime.env;

  if (params.secret !== env.TG_SELLER_WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  const token = env.TG_SELLER_BOT_TOKEN;
  const update = await request.json() as TelegramUpdate;

  if (!update.message?.text) {
    return new Response('ok');
  }

  const text = update.message.text.trim();
  const chatId = String(update.message.chat.id);

  if (!text.startsWith('/start')) {
    return new Response('ok');
  }

  const sellerToken = text.split(' ')[1];
  if (!sellerToken) {
    await sendReply(token, chatId, 'Uzyj linku rejestracyjnego od administratora.');
    return new Response('ok');
  }

  const seller = await env.leadgen.prepare(
    'SELECT id, report_chat_id FROM sellers WHERE token = ?'
  ).bind(sellerToken).first<{ id: number; report_chat_id: string | null }>();

  if (!seller) {
    await sendReply(token, chatId, 'Nieprawidlowy token.');
    return new Response('ok');
  }

  if (seller.report_chat_id === chatId) {
    await sendReply(token, chatId, 'Juz jestes zarejestrowany.');
    return new Response('ok');
  }

  await env.leadgen.prepare(
    'UPDATE sellers SET report_chat_id = ? WHERE token = ?'
  ).bind(chatId, sellerToken).run();

  await sendReply(token, chatId, 'Zarejestrowano! Bedziesz otrzymywac codzienne raporty.');
  return new Response('ok');
};

async function sendReply(token: string, chatId: string, text: string): Promise<void> {
  const { sendMessage } = await import('../../../../lib/telegram');
  await sendMessage(token, chatId, text);
}
