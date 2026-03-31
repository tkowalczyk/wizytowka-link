import type { PresentationOverrides } from '../types/site';
import type { ThemeConfig, LayoutVariant, StyleVariant } from './themes';
import { resolveTheme, getPaletteById } from './themes';
import { getSite, putSite } from './site-store';

export function resolveFullTheme(
  slug: string, category: string, overrides: PresentationOverrides | null,
): ThemeConfig {
  const defaults = resolveTheme(slug, category);

  if (!overrides) return defaults;

  const paletteId = overrides.paletteId ?? defaults.paletteId;
  return {
    paletteId,
    palette: getPaletteById(paletteId) ?? defaults.palette,
    layout: overrides.layout ?? defaults.layout,
    style: overrides.style ?? defaults.style,
  };
}

interface OverrideRow {
  palette_override: string | null;
  layout_override: string | null;
  style_override: string | null;
}

export async function getOverrides(
  db: D1Database, businessId: number,
): Promise<PresentationOverrides | null> {
  const row = await db.prepare(
    `SELECT palette_override, layout_override, style_override FROM businesses WHERE id = ?`,
  ).bind(businessId).first<OverrideRow>();

  if (!row || (!row.palette_override && !row.layout_override && !row.style_override))
    return null;

  return {
    paletteId: row.palette_override ?? undefined,
    layout: (row.layout_override as LayoutVariant) ?? undefined,
    style: (row.style_override as StyleVariant) ?? undefined,
  };
}

export interface ThemeInstruction {
  paletteId?: string;
  layout?: LayoutVariant;
  style?: StyleVariant;
}

export async function changeTheme(
  env: { leadgen: D1Database; sites: R2Bucket },
  params: { businessId: number; locSlug: string; bizSlug: string; overrides: ThemeInstruction },
): Promise<void> {
  const sets: string[] = [];
  const binds: (string | null)[] = [];

  if (params.overrides.paletteId !== undefined) {
    sets.push('palette_override = ?');
    binds.push(params.overrides.paletteId);
  }
  if (params.overrides.layout !== undefined) {
    sets.push('layout_override = ?');
    binds.push(params.overrides.layout);
  }
  if (params.overrides.style !== undefined) {
    sets.push('style_override = ?');
    binds.push(params.overrides.style);
  }

  if (sets.length) {
    binds.push(String(params.businessId));
    await env.leadgen.prepare(
      `UPDATE businesses SET ${sets.join(', ')} WHERE id = ?`,
    ).bind(...binds).run();
  }

  const site = await getSite(env.sites, 'live', params.locSlug, params.bizSlug);
  if (site) {
    if (params.overrides.paletteId) site.theme = params.overrides.paletteId;
    if (params.overrides.layout) site.layout = params.overrides.layout;
    if (params.overrides.style) site.style = params.overrides.style;
    await putSite(env.sites, 'live', params.locSlug, params.bizSlug, site);
  }
}
