export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const SKIP_PARTS = new Set([
  'polska', 'poland', 'pl',
  'dolnośląskie', 'kujawsko-pomorskie', 'lubelskie', 'lubuskie',
  'łódzkie', 'małopolskie', 'mazowieckie', 'opolskie', 'podkarpackie',
  'podlaskie', 'pomorskie', 'śląskie', 'świętokrzyskie',
  'warmińsko-mazurskie', 'wielkopolskie', 'zachodniopomorskie',
]);

const STREET_PREFIXES = ['ul.', 'ul', 'al.', 'al', 'os.', 'os', 'pl.', 'pl'];

export function parseCityFromAddress(address: string | null): string | null {
  if (!address) return null;

  const parts = address.split(',').map(p => p.trim()).filter(Boolean);

  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    const lower = part.toLowerCase();

    if (SKIP_PARTS.has(lower)) continue;
    if (/^\d{2}-\d{3}$/.test(part)) continue; // bare postal code

    // "00-001 Warszawa" pattern
    const postalMatch = part.match(/^\d{2}-\d{3}\s+(.+)$/);
    if (postalMatch) return postalMatch[1].trim();

    // skip street-like parts
    const firstWord = lower.split(/\s+/)[0];
    if (STREET_PREFIXES.includes(firstWord)) continue;
    // skip parts with digits (likely street numbers)
    if (/\d/.test(part)) continue;

    return part;
  }
  return null;
}

interface LocalityMatch {
  id: number;
  name: string;
  slug: string;
}

export async function matchLocalityByName(
  db: D1Database,
  cityName: string,
  lat?: number | null,
  lng?: number | null
): Promise<LocalityMatch | null> {
  const { results } = await db
    .prepare('SELECT id, name, slug, lat, lng FROM localities WHERE name = ? COLLATE NOCASE AND sym = sym_pod')
    .bind(cityName)
    .all<LocalityMatch & { lat: number | null; lng: number | null }>();

  if (!results.length) return null;
  if (results.length === 1) return { id: results[0].id, name: results[0].name, slug: results[0].slug };

  // ambiguous name — disambiguate by GPS if available
  if (lat != null && lng != null) {
    const withCoords = results.filter(r => r.lat != null && r.lng != null);
    if (withCoords.length) {
      let best = withCoords[0];
      let bestDist = haversine(lat, lng, best.lat!, best.lng!);
      for (let i = 1; i < withCoords.length; i++) {
        const d = haversine(lat, lng, withCoords[i].lat!, withCoords[i].lng!);
        if (d < bestDist) {
          bestDist = d;
          best = withCoords[i];
        }
      }
      return { id: best.id, name: best.name, slug: best.slug };
    }
  }

  return null;
}

interface LocalityGpsRow {
  id: number;
  name: string;
  slug: string;
  lat: number;
  lng: number;
}

export async function matchLocalityByGps(
  db: D1Database,
  lat: number,
  lng: number
): Promise<LocalityMatch | null> {
  const NARROW = 0.15;
  const WIDE = 0.5;

  let { results } = await db
    .prepare(
      `SELECT id, name, slug, lat, lng FROM localities
       WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? AND sym = sym_pod`
    )
    .bind(lat - NARROW, lat + NARROW, lng - NARROW, lng + NARROW)
    .all<LocalityGpsRow>();

  if (!results.length) {
    ({ results } = await db
      .prepare(
        `SELECT id, name, slug, lat, lng FROM localities
         WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? AND sym = sym_pod`
      )
      .bind(lat - WIDE, lat + WIDE, lng - WIDE, lng + WIDE)
      .all<LocalityGpsRow>());
  }

  if (!results.length) return null;

  let best = results[0];
  let bestDist = haversine(lat, lng, best.lat, best.lng);
  for (let i = 1; i < results.length; i++) {
    const d = haversine(lat, lng, results[i].lat, results[i].lng);
    if (d < bestDist) {
      bestDist = d;
      best = results[i];
    }
  }

  return { id: best.id, name: best.name, slug: best.slug };
}

export async function resolveLocality(
  db: D1Database,
  address: string | null,
  lat: number | null,
  lng: number | null
): Promise<LocalityMatch | null> {
  const city = parseCityFromAddress(address);
  if (city) {
    const match = await matchLocalityByName(db, city, lat, lng);
    if (match) return match;
  }
  if (lat != null && lng != null) {
    return matchLocalityByGps(db, lat, lng);
  }
  return null;
}
