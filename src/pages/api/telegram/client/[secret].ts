import type { APIRoute } from 'astro';
import type { TelegramUpdate } from '../../../../lib/telegram';
import type { SiteData } from '../../../../types/site';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const env = locals.runtime.env;

  if (params.secret !== env.TG_CLIENT_WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  const token = env.TG_CLIENT_BOT_TOKEN;
  const update = await request.json() as TelegramUpdate;

  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = String(cb.from.id);
    const data = cb.data ?? '';
    const { answerCallback } = await import('../../../../lib/telegram');

    const owner = await env.leadgen.prepare(
      'SELECT business_id FROM business_owners WHERE chat_id = ?'
    ).bind(chatId).first<{ business_id: number }>();

    if (!owner) {
      await answerCallback(token, cb.id, 'Brak dostepu');
      return new Response('ok');
    }

    const [action, bizIdStr] = data.split(':');
    const bizId = parseInt(bizIdStr);

    if (bizId !== owner.business_id) {
      await answerCallback(token, cb.id, 'Brak dostepu');
      return new Response('ok');
    }

    const biz = await env.leadgen.prepare(
      'SELECT slug, locality_id FROM businesses WHERE id = ?'
    ).bind(bizId).first<{ slug: string; locality_id: number }>();
    const loc = await env.leadgen.prepare(
      'SELECT slug FROM localities WHERE id = ?'
    ).bind(biz!.locality_id).first<{ slug: string }>();

    const draftKey = `sites/draft/${loc!.slug}/${biz!.slug}.json`;
    const prodKey = `sites/${loc!.slug}/${biz!.slug}.json`;

    if (action === 'approve') {
      const draft = await env.sites.get(draftKey);
      if (!draft) {
        await answerCallback(token, cb.id, 'Draft wygasl');
        return new Response('ok');
      }
      const body = await draft.text();
      await env.sites.put(prodKey, body, {
        httpMetadata: { contentType: 'application/json' },
      });
      await env.sites.delete(draftKey);
      await answerCallback(token, cb.id, 'Opublikowano!');
      await sendReply(token, chatId, 'Wizytowka zaktualizowana!');
    }

    if (action === 'reject') {
      await env.sites.delete(draftKey);
      await answerCallback(token, cb.id, 'Odrzucono');
      await sendReply(token, chatId, 'Zmiany odrzucone. Wyslij nowa instrukcje.');
    }

    return new Response('ok');
  }

  if (!update.message?.text) {
    return new Response('ok');
  }

  const text = update.message.text.trim();
  const chatId = String(update.message.chat.id);

  // /start biz_* — link owner to business
  if (text.startsWith('/start')) {
    const bizToken = text.split(' ')[1];

    if (!bizToken || !bizToken.startsWith('biz_')) {
      await sendReply(token, chatId, 'Uzyj linku rejestracyjnego od administratora.');
      return new Response('ok');
    }

    const owner = await env.leadgen.prepare(
      'SELECT id, business_id, chat_id FROM business_owners WHERE token = ?'
    ).bind(bizToken).first<{ id: number; business_id: number; chat_id: string }>();

    if (!owner) {
      await sendReply(token, chatId, 'Nieprawidlowy token.');
      return new Response('ok');
    }

    if (owner.chat_id && owner.chat_id === chatId) {
      await sendReply(token, chatId, 'Juz jestes polaczony. Wyslij wiadomosc aby edytowac wizytowke.');
      return new Response('ok');
    }

    await env.leadgen.prepare(
      'UPDATE business_owners SET chat_id = ? WHERE token = ?'
    ).bind(chatId, bizToken).run();

    const biz = await env.leadgen.prepare(
      'SELECT title FROM businesses WHERE id = ?'
    ).bind(owner.business_id).first<{ title: string }>();

    const { escapeHtml } = await import('../../../../lib/telegram');
    await sendReply(token, chatId,
      `Polaczono z wizytowka: <b>${escapeHtml(biz?.title ?? '')}</b>\n\n` +
      'Wyslij wiadomosc aby edytowac, np.:\n' +
      '- "dodaj usluge: tapicerowanie"\n' +
      '- "zmien godziny otwarcia na 8-16"\n' +
      '- "zmien adres na ul. Nowa 5"'
    );
    return new Response('ok');
  }

  // Owner editing flow: non-command message from registered owner
  const owner = await env.leadgen.prepare(
    'SELECT business_id FROM business_owners WHERE chat_id = ?'
  ).bind(chatId).first<{ business_id: number }>();

  if (owner) {
    const biz = await env.leadgen.prepare(
      'SELECT slug, locality_id FROM businesses WHERE id = ?'
    ).bind(owner.business_id).first<{ slug: string; locality_id: number }>();

    const loc = await env.leadgen.prepare(
      'SELECT slug FROM localities WHERE id = ?'
    ).bind(biz!.locality_id).first<{ slug: string }>();

    const key = `sites/${loc!.slug}/${biz!.slug}.json`;
    const obj = await env.sites.get(key);
    if (!obj) {
      await sendReply(token, chatId, 'Wizytowka jeszcze nie zostala wygenerowana.');
      return new Response('ok');
    }

    const currentSite = await obj.json() as SiteData;

    try {
      const { patchSiteData, summarizeChanges } = await import('../../../../lib/editor');
      const { escapeHtml, sendMessageWithKeyboard, sendChatAction } = await import('../../../../lib/telegram');

      await sendChatAction(token, chatId);

      const patched = await patchSiteData(env, currentSite, text);

      const draftKey = `sites/draft/${loc!.slug}/${biz!.slug}.json`;
      await env.sites.put(draftKey, JSON.stringify(patched), {
        httpMetadata: { contentType: 'application/json' },
      });

      const previewUrl = `https://wizytowka.link/${loc!.slug}/${biz!.slug}?draft=1`;
      const summary = summarizeChanges(currentSite, patched);

      await sendMessageWithKeyboard(token, chatId,
        `<b>Proponowane zmiany:</b>\n\n${escapeHtml(summary)}\n\n` +
        `<a href="${previewUrl}">Podglad wizytowki</a>`,
        [[
          { text: 'Zatwierdz', callback_data: `approve:${owner.business_id}` },
          { text: 'Odrzuc', callback_data: `reject:${owner.business_id}` },
        ]]
      );
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith('GLM-5')) {
        await sendReply(token, chatId, 'Blad serwera. Sprobuj za chwile.');
      } else {
        await sendReply(token, chatId, 'Nie udalo sie przetworzyc zmian. Sprobuj ponownie.');
      }
    }

    return new Response('ok');
  }

  return new Response('ok');
};

async function sendReply(token: string, chatId: string, text: string): Promise<void> {
  const { sendMessage } = await import('../../../../lib/telegram');
  await sendMessage(token, chatId, text);
}
