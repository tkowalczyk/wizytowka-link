import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { siteKey, getSite, putSite, promoteDraft, deleteSite } from './site-store';
import type { SiteData } from '../types/site';

const SAMPLE: SiteData = {
  hero: { headline: 'Witamy', subheadline: 'Najlepsza firma' },
  about: { title: 'O nas', text: 'Opis firmy' },
  services: [{ name: 'Usługa 1', description: 'Opis usługi' }],
  contact: { cta_text: 'Zadzwoń', phone: '123456789', address: 'ul. Test 1' },
  seo: { title: 'Firma', description: 'Opis SEO' },
};

describe('siteKey', () => {
  it('returns live R2 path', () => {
    expect(siteKey('live', 'krakow', 'foo-bar')).toBe('sites/krakow/foo-bar.json');
  });

  it('returns draft R2 path', () => {
    expect(siteKey('draft', 'krakow', 'foo-bar')).toBe('sites/draft/krakow/foo-bar.json');
  });
});

describe('putSite + getSite', () => {
  it('round-trips SiteData through R2', async () => {
    await putSite(env.sites, 'live', 'krakow', 'test-biz', SAMPLE);
    const result = await getSite(env.sites, 'live', 'krakow', 'test-biz');
    expect(result).toEqual(SAMPLE);
  });

  it('returns null for missing key', async () => {
    const result = await getSite(env.sites, 'live', 'krakow', 'nonexistent');
    expect(result).toBeNull();
  });
});

describe('promoteDraft', () => {
  it('copies draft to live and deletes draft', async () => {
    await putSite(env.sites, 'draft', 'krakow', 'promo-biz', SAMPLE);
    const ok = await promoteDraft(env.sites, 'krakow', 'promo-biz');
    expect(ok).toBe(true);
    expect(await getSite(env.sites, 'live', 'krakow', 'promo-biz')).toEqual(SAMPLE);
    expect(await getSite(env.sites, 'draft', 'krakow', 'promo-biz')).toBeNull();
  });

  it('returns false when no draft exists', async () => {
    const ok = await promoteDraft(env.sites, 'krakow', 'no-draft');
    expect(ok).toBe(false);
  });
});

describe('deleteSite', () => {
  it('removes the key from R2', async () => {
    await putSite(env.sites, 'live', 'krakow', 'del-biz', SAMPLE);
    await deleteSite(env.sites, 'live', 'krakow', 'del-biz');
    expect(await getSite(env.sites, 'live', 'krakow', 'del-biz')).toBeNull();
  });
});
