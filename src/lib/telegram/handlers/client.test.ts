import { env } from 'cloudflare:workers';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startLinkHandler, draftCallbackHandler, ownerEditHandler } from './client';
import { resetDb, TEST_IDS } from '../../../../test/seed';
import { putSite } from '../../site-store';
import type { TgContext } from '../types';
import type { TelegramUpdate } from '../../telegram';
import type { SiteData } from '../../../types/site';

// -- helpers --

function makeCtx(overrides: Partial<TgContext> = {}): TgContext {
  return {
    env,
    token: 'test-token',
    chatId: '999',
    update: { update_id: 1 } as TelegramUpdate,
    reply: vi.fn(async () => {}),
    replyWithKeyboard: vi.fn(async () => {}),
    typing: vi.fn(async () => {}),
    ...overrides,
  };
}

function msgUpdate(text: string, chatId = 999): TelegramUpdate {
  return {
    update_id: 1,
    message: { message_id: 1, chat: { id: chatId, type: 'private' }, text, date: 0 },
  };
}

function cbUpdate(data: string, fromId = 200001): TelegramUpdate {
  return {
    update_id: 1,
    callback_query: {
      id: 'cb-1',
      from: { id: fromId },
      message: { message_id: 1, chat: { id: fromId, type: 'private' }, date: 0 },
      data,
    },
  };
}

const STUB_SITE: SiteData = {
  hero: { headline: 'Test', subheadline: 'Sub' },
  about: { title: 'O nas', text: 'About' },
  services: [],
  contact: { cta_text: 'Zadzwoń', phone: '+48123456789', address: 'ul. Testowa 1' },
  seo: { title: 'Test', description: 'Desc' },
};

// -- startLinkHandler tests --

describe('startLinkHandler', () => {
  beforeEach(async () => {
    await resetDb(env.leadgen);
  });

  it('matches /start biz_* messages', () => {
    expect(startLinkHandler.match(msgUpdate('/start biz_abc'), makeCtx())).toBe(true);
  });

  it('does not match /start without biz_ prefix', () => {
    expect(startLinkHandler.match(msgUpdate('/start seller_token'), makeCtx())).toBe(false);
  });

  it('does not match regular messages', () => {
    expect(startLinkHandler.match(msgUpdate('hello'), makeCtx())).toBe(false);
  });

  it('replies error for invalid token', async () => {
    const update = msgUpdate('/start biz_nonexistent');
    const ctx = makeCtx({ update });
    await startLinkHandler.handle(ctx);
    expect(ctx.reply).toHaveBeenCalledWith('Nieprawidlowy token.');
  });

  it('links owner chat_id with valid token', async () => {
    // biz_piekarnia_token has chat_id=NULL in seed
    const update = msgUpdate(`/start ${TEST_IDS.tokens.bizPiekarnia}`);
    const ctx = makeCtx({ chatId: '555', update });
    await startLinkHandler.handle(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Polaczono'));

    const owner = await env.leadgen.prepare(
      'SELECT chat_id FROM business_owners WHERE token = ?'
    ).bind(TEST_IDS.tokens.bizPiekarnia).first<{ chat_id: string }>();
    expect(owner!.chat_id).toBe('555');
  });

  it('replies idempotent when already linked', async () => {
    // biz_hydraulik_token has chat_id='200001' in seed
    const update = msgUpdate(`/start ${TEST_IDS.tokens.bizHydraulik}`);
    const ctx = makeCtx({ chatId: '200001', update });
    await startLinkHandler.handle(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Juz jestes polaczony'));
  });
});

// -- draftCallbackHandler tests --
// Seed: owner id=1, business_id=1 (hydraulik-warszawa), chat_id='200001'
// Business 1: slug='hydraulik-warszawa', locality_id=2 (warszawa)

describe('draftCallbackHandler', () => {
  beforeEach(async () => {
    await resetDb(env.leadgen);
  });

  it('matches approve: callback data', () => {
    expect(draftCallbackHandler.match(cbUpdate('approve:1'), makeCtx())).toBe(true);
  });

  it('matches reject: callback data', () => {
    expect(draftCallbackHandler.match(cbUpdate('reject:1'), makeCtx())).toBe(true);
  });

  it('does not match other callback data', () => {
    expect(draftCallbackHandler.match(cbUpdate('other:1'), makeCtx())).toBe(false);
  });

  it('denies access when no owner found', async () => {
    const update = cbUpdate('approve:1', 999999);
    const ctx = makeCtx({ chatId: '999999', update });
    await draftCallbackHandler.handle(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Brak dostepu'));
  });

  it('denies access when business_id mismatch', async () => {
    // owner 200001 owns business 1, but callback says business 4
    const update = cbUpdate('approve:4', 200001);
    const ctx = makeCtx({ chatId: '200001', update });
    await draftCallbackHandler.handle(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Brak dostepu'));
  });

  it('approve promotes draft to live', async () => {
    // Put a draft in R2
    await putSite(env.sites, 'draft', 'warszawa', 'hydraulik-warszawa', STUB_SITE);

    const update = cbUpdate('approve:1', 200001);
    const ctx = makeCtx({ chatId: '200001', update });
    await draftCallbackHandler.handle(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('zaktualizowana'));

    // Draft should be gone, live should exist
    const { getSite } = await import('../../site-store');
    const draft = await getSite(env.sites, 'draft', 'warszawa', 'hydraulik-warszawa');
    const live = await getSite(env.sites, 'live', 'warszawa', 'hydraulik-warszawa');
    expect(draft).toBeNull();
    expect(live).not.toBeNull();
  });

  it('approve replies expired when no draft exists', async () => {
    const update = cbUpdate('approve:1', 200001);
    const ctx = makeCtx({ chatId: '200001', update });
    await draftCallbackHandler.handle(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('wygasl'));
  });

  it('reject deletes draft', async () => {
    await putSite(env.sites, 'draft', 'warszawa', 'hydraulik-warszawa', STUB_SITE);

    const update = cbUpdate('reject:1', 200001);
    const ctx = makeCtx({ chatId: '200001', update });
    await draftCallbackHandler.handle(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('odrzucone'));

    const { getSite } = await import('../../site-store');
    const draft = await getSite(env.sites, 'draft', 'warszawa', 'hydraulik-warszawa');
    expect(draft).toBeNull();
  });
});

// -- ownerEditHandler tests --
// Owner chat_id='200001' → business 1 (hydraulik-warszawa, locality=warszawa)

describe('ownerEditHandler', () => {
  const PATCHED_SITE: SiteData = {
    ...STUB_SITE,
    hero: { ...STUB_SITE.hero, headline: 'Patched' },
  };

  beforeEach(async () => {
    await resetDb(env.leadgen);
    // Clean R2
    const list = await env.sites.list();
    for (const obj of list.objects) {
      await env.sites.delete(obj.key);
    }
  });

  it('matches regular text messages', () => {
    expect(ownerEditHandler.match(msgUpdate('zmien adres'), makeCtx())).toBe(true);
  });

  it('does not match /commands', () => {
    expect(ownerEditHandler.match(msgUpdate('/start'), makeCtx())).toBe(false);
  });

  it('silently returns for unregistered users', async () => {
    const update = msgUpdate('zmien adres', 999);
    const ctx = makeCtx({ chatId: '999', update });
    await ownerEditHandler.handle(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('replies error when site not generated yet', async () => {
    // Owner 200001 owns biz 1, but no R2 site
    const update = msgUpdate('zmien adres', 200001);
    const ctx = makeCtx({ chatId: '200001', update });
    await ownerEditHandler.handle(ctx);
    expect(ctx.reply).toHaveBeenCalledWith('Wizytowka jeszcze nie zostala wygenerowana.');
  });

  it('runs LLM edit flow and saves draft', async () => {
    // Put a live site
    await putSite(env.sites, 'live', 'warszawa', 'hydraulik-warszawa', STUB_SITE);

    const stubEditContent = vi.fn(async () => PATCHED_SITE);
    const stubSummarize = vi.fn(() => 'Naglowek: "Patched"');
    const handler = ownerEditHandler.withDeps!({
      editContent: stubEditContent,
      summarizeChanges: stubSummarize,
    });

    const update = msgUpdate('zmien naglowek na Patched', 200001);
    const ctx = makeCtx({ chatId: '200001', update });
    await handler.handle(ctx);

    expect(ctx.typing).toHaveBeenCalled();
    expect(stubEditContent).toHaveBeenCalled();
    expect(ctx.replyWithKeyboard).toHaveBeenCalledWith(
      expect.stringContaining('Proponowane zmiany'),
      expect.arrayContaining([expect.arrayContaining([
        expect.objectContaining({ text: 'Zatwierdz' }),
        expect.objectContaining({ text: 'Odrzuc' }),
      ])]),
    );

    // Draft should be in R2
    const { getSite } = await import('../../site-store');
    const draft = await getSite(env.sites, 'draft', 'warszawa', 'hydraulik-warszawa');
    expect(draft).not.toBeNull();
    expect(draft!.hero.headline).toBe('Patched');
  });

  it('replies error when LLM fails', async () => {
    await putSite(env.sites, 'live', 'warszawa', 'hydraulik-warszawa', STUB_SITE);

    const handler = ownerEditHandler.withDeps!({
      editContent: vi.fn(async () => { throw new Error('GLM-5 timeout'); }),
      summarizeChanges: vi.fn(() => ''),
    });

    const update = msgUpdate('zmien cos', 200001);
    const ctx = makeCtx({ chatId: '200001', update });
    await handler.handle(ctx);

    expect(ctx.reply).toHaveBeenCalledWith('Blad serwera. Sprobuj za chwile.');
  });

  it('replies generic error for non-LLM failures', async () => {
    await putSite(env.sites, 'live', 'warszawa', 'hydraulik-warszawa', STUB_SITE);

    const handler = ownerEditHandler.withDeps!({
      editContent: vi.fn(async () => { throw new Error('random failure'); }),
      summarizeChanges: vi.fn(() => ''),
    });

    const update = msgUpdate('zmien cos', 200001);
    const ctx = makeCtx({ chatId: '200001', update });
    await handler.handle(ctx);

    expect(ctx.reply).toHaveBeenCalledWith('Nie udalo sie przetworzyc zmian. Sprobuj ponownie.');
  });
});
