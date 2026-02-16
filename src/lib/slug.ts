const POLISH_MAP: Record<string, string> = {
  'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n',
  'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
  'Ą': 'a', 'Ć': 'c', 'Ę': 'e', 'Ł': 'l', 'Ń': 'n',
  'Ó': 'o', 'Ś': 's', 'Ź': 'z', 'Ż': 'z',
};

export function slugify(input: string): string {
  return input
    .replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (ch) => POLISH_MAP[ch] ?? ch)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const MAX_SLUG_ATTEMPTS = 50;

export async function generateUniqueSlug(
  title: string,
  localityId: number,
  db: D1Database
): Promise<string> {
  const base = slugify(title);

  const { results } = await db
    .prepare(
      `SELECT slug FROM businesses
       WHERE locality_id = ? AND (slug = ? OR slug LIKE ?)
       ORDER BY slug`
    )
    .bind(localityId, base, `${base}-%`)
    .all<{ slug: string }>();

  const existing = new Set(results.map((r) => r.slug));

  if (!existing.has(base)) return base;

  for (let suffix = 2; suffix <= MAX_SLUG_ATTEMPTS + 1; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }

  throw new Error(`slug collision limit exceeded: ${base} in locality ${localityId}`);
}
