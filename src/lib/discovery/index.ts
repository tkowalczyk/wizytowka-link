export type {
  DiscoveryDeps,
  DiscoveryStats,
  LocalityStats,
  SearchPort,
  NotifyPort,
} from './ports';

import type { BusinessInsert, Locality, SellerRow } from '../../types/business';
import type { SerpApiLocalResult, SerpApiMapsResponse } from '../../types/serpapi';
import type {
  DiscoveryDeps,
  DiscoveryErrorKind,
  DiscoveryStats,
  LocalityStats,
  SearchPort,
  NotifyPort,
} from './ports';
import { slugify } from '../slug';
import { normalizePhone } from '../phone';
import { sendDailyReport, formatCronSection } from '../telegram';
import type { LeadSummary, DailyReportStats } from '../telegram';
import { getCronSummary } from '../cron-log';
import { SerpApiError } from './errors';
import { SKIP_FLAG_KEY, kvStatePort } from './preflight';

export { SerpApiError } from './errors';

const BATCH_SIZE = 5;
const MAX_LOCALITY_ATTEMPTS = 5;
const SERPAPI_BASE = 'https://serpapi.com/search.json';
const MAX_PAGES_PER_CATEGORY = 5;

const DEFAULT_CATEGORIES = [
  'firma', 'sklep', 'restauracja', 'hydraulik', 'elektryk',
  'mechanik', 'fryzjer', 'dentysta', 'weterynarz', 'kwiaciarnia',
  'piekarnia', 'zakład pogrzebowy', 'fotograf', 'księgowość',
  'fizjoterapia', 'przedszkole', 'autokomis', 'usługi',
];

function createSerpApiSearch(env: Env): SearchPort {
  return {
    async search(locality, category) {
      const results: SerpApiLocalResult[] = [];
      const q = encodeURIComponent(`${category} ${locality.name}`);
      let url: string | null = `${SERPAPI_BASE}?engine=google_maps&q=${q}&ll=@${locality.lat},${locality.lng},14z&api_key=${env.SERP_API_KEY}`;
      let page = 0;
      let calls = 0;
      try {
        while (url && page < MAX_PAGES_PER_CATEGORY) {
          const res = await fetch(url);
          calls++;
          if (!res.ok) throw new SerpApiError(`SerpAPI ${res.status}`, { calls, status: res.status });
          const data: SerpApiMapsResponse = await res.json();
          if (data.local_results) results.push(...data.local_results);
          const next = data.serpapi_pagination?.next ?? null;
          url = next ? `${next}&api_key=${env.SERP_API_KEY}` : null;
          page++;
        }
      } catch (err) {
        if (err instanceof SerpApiError) throw err;
        throw new SerpApiError(err instanceof Error ? err.message : String(err), { calls });
      }
      return { results, calls };
    },
  };
}

function createTelegramNotify(env: Env): NotifyPort {
  return {
    async reportToSellers(stats) {
      const totalResult = await env.leadgen.prepare(
        "SELECT COUNT(*) as cnt FROM businesses WHERE created_at >= date('now')"
      ).first<{ cnt: number }>();

      const newLeads = stats.totalNewLeads;

      const topLeads = await env.leadgen.prepare(`
        SELECT title, category, phone FROM businesses
        WHERE website IS NULL AND phone IS NOT NULL AND created_at >= date('now')
        ORDER BY id DESC LIMIT 5
      `).all<LeadSummary>();

      const cronStats = await getCronSummary(env.leadgen);
      const cronSection = formatCronSection(cronStats, {
        '0 * * * *': 'Geocoder',
        '0 8 * * *': 'Discovery',
        '*/5 * * * *': 'Generator',
      });

      const reportStats: DailyReportStats = {
        locality_name: stats.localities.map(l => l.name).join(', '),
        total_businesses: totalResult?.cnt ?? 0,
        new_leads: newLeads,
        top_leads: topLeads.results,
        cronSection,
        quotaExhausted: stats.quotaExhausted,
      };

      const sellers = await env.leadgen.prepare(
        'SELECT id, name, report_chat_id, token FROM sellers WHERE report_chat_id IS NOT NULL'
      ).all<SellerRow>();

      for (const seller of sellers.results) {
        try {
          await sendDailyReport(env.TG_SELLER_BOT_TOKEN, seller, reportStats);
        } catch (err) {
          console.log(`telegram: failed for seller ${seller.id}: ${err}`);
        }
      }
    },
  };
}

export function createDiscoveryDeps(env: Env): DiscoveryDeps {
  return {
    db: env.leadgen,
    searchApi: createSerpApiSearch(env),
    notify: createTelegramNotify(env),
    categories: DEFAULT_CATEGORIES,
    state: env.STATE ? kvStatePort(env.STATE) : undefined,
  };
}

export async function runDiscovery(deps: DiscoveryDeps): Promise<DiscoveryStats> {
  const { db, searchApi, categories } = deps;

  // Pre-flight skip — if quota check earlier today set the skip flag, bail out before
  // burning a single SerpAPI call. The flag carries searchesLeft so the alert is precise.
  const skipPayload = deps.state ? await deps.state.get(SKIP_FLAG_KEY) : null;
  if (skipPayload) {
    let searchesLeft: number | null = null;
    try {
      searchesLeft = (JSON.parse(skipPayload) as { searchesLeft?: number | null }).searchesLeft ?? null;
    } catch {}
    await deps.state!.delete(SKIP_FLAG_KEY);
    return {
      localities: [],
      totalApiCalls: 0,
      totalBusinesses: 0,
      totalNewLeads: 0,
      quotaExhausted: false,
      errorKind: 'preflight-skip',
      searchesLeft,
    };
  }

  const localityStats: LocalityStats[] = [];
  let totalApiCalls = 0;
  let errorKind: DiscoveryErrorKind | null = null;
  let hardStop = false;

  for (let attempt = 0; attempt < MAX_LOCALITY_ATTEMPTS; attempt++) {
    const locality = await getNextLocality(db);
    if (!locality) break;

    const seen = new Set<string>();
    const businesses: BusinessInsert[] = [];
    let apiCalls = 0;

    for (const category of categories) {
      if (hardStop) break;
      try {
        const { results, calls } = await searchApi.search(locality, category);
        apiCalls += calls;
        for (const r of results) {
          if (seen.has(r.place_id)) continue;
          seen.add(r.place_id);

          const resolved = await resolveLocality(db, r.address ?? null, r.gps_coordinates.latitude, r.gps_coordinates.longitude);
          const localityId = resolved?.id ?? locality.id;
          const slug = await generateUniqueSlug(r.title, localityId, db);

          businesses.push(toBusiness(r, slug, localityId, category));
        }
      } catch (err) {
        if (err instanceof SerpApiError) {
          apiCalls += err.calls;
          errorKind = err.kind;
          if (err.kind === 'auth' || err.kind === 'payment' || err.kind === 'quota') {
            hardStop = true;
            break;
          }
        }
        console.error(`[discovery] ${category}@${locality.name}: ${err}`);
      }
    }

    await batchInsert(db, businesses);
    await markSearched(db, locality.id);

    const newLeads = await countTodayLeads(db);
    totalApiCalls += apiCalls;
    localityStats.push({ name: locality.name, businesses: businesses.length, apiCalls, newLeads });

    if (newLeads > 0 || hardStop) break;
  }

  const stats: DiscoveryStats = {
    localities: localityStats,
    totalApiCalls,
    totalBusinesses: localityStats.reduce((s, l) => s + l.businesses, 0),
    totalNewLeads: localityStats.reduce((s, l) => s + l.newLeads, 0),
    quotaExhausted: errorKind === 'quota',
    errorKind,
  };

  if (localityStats.length > 0) {
    await deps.notify.reportToSellers(stats);
  }

  return stats;
}

export async function discoverBusinesses(env: Env): Promise<DiscoveryStats> {
  return runDiscovery(createDiscoveryDeps(env));
}

// -- internal: locality resolution --

interface LocalityMatch { id: number; name: string; slug: string }

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
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

function parseCityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(',').map(p => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    const lower = part.toLowerCase();
    if (SKIP_PARTS.has(lower)) continue;
    if (/^\d{2}-\d{3}$/.test(part)) continue;
    const postalMatch = part.match(/^\d{2}-\d{3}\s+(.+)$/);
    if (postalMatch) return postalMatch[1].trim();
    const firstWord = lower.split(/\s+/)[0];
    if (STREET_PREFIXES.includes(firstWord)) continue;
    if (/\d/.test(part)) continue;
    return part;
  }
  return null;
}

async function matchLocalityByName(db: D1Database, cityName: string, lat?: number | null, lng?: number | null): Promise<LocalityMatch | null> {
  const { results } = await db
    .prepare('SELECT id, name, slug, lat, lng FROM localities WHERE name = ? COLLATE NOCASE AND sym = sym_pod')
    .bind(cityName)
    .all<LocalityMatch & { lat: number | null; lng: number | null }>();
  if (!results.length) return null;
  if (results.length === 1) return { id: results[0].id, name: results[0].name, slug: results[0].slug };
  if (lat != null && lng != null) {
    const withCoords = results.filter(r => r.lat != null && r.lng != null);
    if (withCoords.length) {
      let best = withCoords[0];
      let bestDist = haversine(lat, lng, best.lat!, best.lng!);
      for (let i = 1; i < withCoords.length; i++) {
        const d = haversine(lat, lng, withCoords[i].lat!, withCoords[i].lng!);
        if (d < bestDist) { bestDist = d; best = withCoords[i]; }
      }
      return { id: best.id, name: best.name, slug: best.slug };
    }
  }
  return null;
}

async function matchLocalityByGps(db: D1Database, lat: number, lng: number): Promise<LocalityMatch | null> {
  const NARROW = 0.15;
  const WIDE = 0.5;
  let { results } = await db
    .prepare('SELECT id, name, slug, lat, lng FROM localities WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? AND sym = sym_pod')
    .bind(lat - NARROW, lat + NARROW, lng - NARROW, lng + NARROW)
    .all<LocalityMatch & { lat: number; lng: number }>();
  if (!results.length) {
    ({ results } = await db
      .prepare('SELECT id, name, slug, lat, lng FROM localities WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? AND sym = sym_pod')
      .bind(lat - WIDE, lat + WIDE, lng - WIDE, lng + WIDE)
      .all<LocalityMatch & { lat: number; lng: number }>());
  }
  if (!results.length) return null;
  let best = results[0];
  let bestDist = haversine(lat, lng, best.lat, best.lng);
  for (let i = 1; i < results.length; i++) {
    const d = haversine(lat, lng, results[i].lat, results[i].lng);
    if (d < bestDist) { bestDist = d; best = results[i]; }
  }
  return { id: best.id, name: best.name, slug: best.slug };
}

async function resolveLocality(db: D1Database, address: string | null, lat: number | null, lng: number | null): Promise<LocalityMatch | null> {
  const city = parseCityFromAddress(address);
  if (city) {
    const match = await matchLocalityByName(db, city, lat, lng);
    if (match) return match;
  }
  if (lat != null && lng != null) return matchLocalityByGps(db, lat, lng);
  return null;
}

// -- internal: slug --

const MAX_SLUG_ATTEMPTS = 50;

async function generateUniqueSlug(title: string, localityId: number, db: D1Database): Promise<string> {
  const base = slugify(title);
  const { results } = await db
    .prepare('SELECT slug FROM businesses WHERE locality_id = ? AND (slug = ? OR slug LIKE ?) ORDER BY slug')
    .bind(localityId, base, `${base}-%`)
    .all<{ slug: string }>();
  const existing = new Set(results.map(r => r.slug));
  if (!existing.has(base)) return base;
  for (let suffix = 2; suffix <= MAX_SLUG_ATTEMPTS + 1; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error(`slug collision limit exceeded: ${base} in locality ${localityId}`);
}

// -- internal: DB helpers --

async function getNextLocality(db: D1Database): Promise<Locality | null> {
  return db
    .prepare('SELECT * FROM localities WHERE searched_at IS NULL AND lat IS NOT NULL AND geocode_failed = 0 ORDER BY distance_km LIMIT 1')
    .first<Locality>();
}

async function countTodayLeads(db: D1Database): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) as cnt FROM businesses WHERE website IS NULL AND phone IS NOT NULL AND created_at >= date('now')").first<{ cnt: number }>();
  return r?.cnt ?? 0;
}

async function markSearched(db: D1Database, localityId: number): Promise<void> {
  await db.prepare("UPDATE localities SET searched_at = datetime('now') WHERE id = ?").bind(localityId).run();
}

function toBusiness(r: SerpApiLocalResult, slug: string, localityId: number, category: string): BusinessInsert {
  return {
    title: r.title,
    slug,
    phone: r.phone ? normalizePhone(r.phone) : null,
    address: r.address ?? null,
    website: r.website ?? null,
    category,
    rating: r.rating ?? null,
    gps_lat: r.gps_coordinates.latitude,
    gps_lng: r.gps_coordinates.longitude,
    place_id: r.place_id,
    data_cid: r.data_cid ?? null,
    locality_id: localityId,
    reviews_count: r.reviews ?? null,
    google_type: r.type ?? null,
    google_types: r.types ? JSON.stringify(r.types) : null,
    description: r.description ?? null,
    operating_hours: r.operating_hours ? JSON.stringify(r.operating_hours) : null,
    thumbnail_url: r.thumbnail ?? null,
    unclaimed: r.unclaimed_listing ? 1 : 0,
  };
}

async function batchInsert(db: D1Database, businesses: BusinessInsert[]): Promise<void> {
  for (let i = 0; i < businesses.length; i += BATCH_SIZE) {
    const chunk = businesses.slice(i, i + BATCH_SIZE);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values = chunk.flatMap(b => [
      b.title, b.slug, b.phone, b.address, b.website,
      b.category, b.rating, b.gps_lat, b.gps_lng,
      b.place_id, b.data_cid, b.locality_id,
      b.reviews_count, b.google_type, b.google_types,
      b.description, b.operating_hours, b.thumbnail_url, b.unclaimed,
    ]);
    await db.prepare(
      `INSERT OR IGNORE INTO businesses
       (title, slug, phone, address, website, category, rating,
        gps_lat, gps_lng, place_id, data_cid, locality_id,
        reviews_count, google_type, google_types, description,
        operating_hours, thumbnail_url, unclaimed)
       VALUES ${placeholders}`
    ).bind(...values).run();
  }
}
