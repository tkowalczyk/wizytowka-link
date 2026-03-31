import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { resolveFullTheme, getOverrides, changeTheme } from './presentation';
import { resolveTheme } from './themes';
import { putSite, getSite } from './site-store';
import { resetDb, TEST_IDS } from '../../test/seed';
import type { SiteData } from '../types/site';

describe('resolveFullTheme', () => {
  it('matches hash defaults when no overrides', () => {
    const expected = resolveTheme('test-slug', 'restauracja');
    const result = resolveFullTheme('test-slug', 'restauracja', null);
    expect(result.paletteId).toBe(expected.paletteId);
    expect(result.layout).toBe(expected.layout);
    expect(result.style).toBe(expected.style);
  });

  it('applies palette override', () => {
    const result = resolveFullTheme('test-slug', 'restauracja', { paletteId: 'ocean' });
    expect(result.paletteId).toBe('ocean');
  });

  it('applies layout override', () => {
    const result = resolveFullTheme('test-slug', 'restauracja', { layout: 'split' });
    expect(result.layout).toBe('split');
  });

  it('applies style override', () => {
    const result = resolveFullTheme('test-slug', 'restauracja', { style: 'bold' });
    expect(result.style).toBe('bold');
  });

  it('mixes partial overrides with hash defaults', () => {
    const defaults = resolveTheme('mix-slug', 'dentysta');
    const result = resolveFullTheme('mix-slug', 'dentysta', { paletteId: 'crimson' });
    expect(result.paletteId).toBe('crimson');
    expect(result.layout).toBe(defaults.layout);
    expect(result.style).toBe(defaults.style);
  });
});

const SAMPLE_SITE: SiteData = {
  hero: { headline: 'Witamy', subheadline: 'Sub' },
  about: { title: 'O nas', text: 'Tekst' },
  services: [{ name: 'S1', description: 'D1' }],
  contact: { cta_text: 'Zadzwoń', phone: '123', address: 'ul. X' },
  seo: { title: 'Firma', description: 'Opis' },
  theme: 'sunset',
};

describe('getOverrides', () => {
  beforeEach(() => resetDb(env.leadgen));

  it('returns null when no overrides set', async () => {
    const result = await getOverrides(env.leadgen, TEST_IDS.businesses.hydraulikWarszawa);
    expect(result).toBeNull();
  });

  it('returns overrides after D1 update', async () => {
    await env.leadgen.prepare(
      `UPDATE businesses SET palette_override = 'ocean', layout_override = 'split' WHERE id = ?`
    ).bind(TEST_IDS.businesses.hydraulikWarszawa).run();
    const result = await getOverrides(env.leadgen, TEST_IDS.businesses.hydraulikWarszawa);
    expect(result).toEqual({ paletteId: 'ocean', layout: 'split', style: undefined });
  });
});

describe('changeTheme', () => {
  beforeEach(async () => {
    await resetDb(env.leadgen);
    await putSite(env.sites, 'live', 'warszawa', 'hydraulik-warszawa', SAMPLE_SITE);
  });

  it('updates D1 overrides and re-stamps R2 without changing content', async () => {
    await changeTheme(env, {
      businessId: TEST_IDS.businesses.hydraulikWarszawa,
      locSlug: 'warszawa',
      bizSlug: 'hydraulik-warszawa',
      overrides: { paletteId: 'forest', style: 'bold' },
    });

    const overrides = await getOverrides(env.leadgen, TEST_IDS.businesses.hydraulikWarszawa);
    expect(overrides?.paletteId).toBe('forest');
    expect(overrides?.style).toBe('bold');

    const site = await getSite(env.sites, 'live', 'warszawa', 'hydraulik-warszawa');
    expect(site!.theme).toBe('forest');
    expect(site!.style).toBe('bold');
    expect(site!.hero.headline).toBe('Witamy');
  });
});
