import type { BusinessInsert, Locality } from '../types/business';
import { searchCategory } from './scraper-api';
import { generateUniqueSlug } from './slug';
import { resolveLocality } from './locality-matcher';
import { sendDailyReport } from './telegram';
import type { LeadSummary, DailyReportStats } from './telegram';
import type { SellerRow } from '../types/business';

const CATEGORIES = [
  'firma', 'sklep', 'restauracja', 'hydraulik', 'elektryk',
  'mechanik', 'fryzjer', 'dentysta', 'weterynarz', 'kwiaciarnia',
  'piekarnia', 'zakład pogrzebowy', 'fotograf', 'księgowość',
  'fizjoterapia', 'przedszkole', 'autokomis', 'usługi',
] as const;

// D1 max 100 bound params; 19 cols × 5 = 95
const BATCH_SIZE = 5;

const MAX_LOCALITY_ATTEMPTS = 5;

export async function scrapeBusinesses(env: Env): Promise<void> {
  let reportLocality: Locality | null = null;
  let totalApiCalls = 0;

  for (let attempt = 0; attempt < MAX_LOCALITY_ATTEMPTS; attempt++) {
    const locality = await getNextLocality(env.leadgen);
    if (!locality) break;

    const { newLeads, apiCalls, quotaExhausted } = await scrapeLocality(env, locality);
    totalApiCalls += apiCalls;
    await markSearched(env.leadgen, locality.id);

    if (newLeads > 0) {
      reportLocality = locality;
      break;
    }

    console.log(`[scraper] ${locality.name}: 0 new leads, skipping (attempt ${attempt + 1}/${MAX_LOCALITY_ATTEMPTS})`);

    if (quotaExhausted) {
      console.log(`[scraper] quota exhausted — stopping after ${attempt + 1} attempts`);
      break;
    }
  }

  if (!reportLocality) {
    console.log(`[scraper] no new leads found in ${MAX_LOCALITY_ATTEMPTS} attempts, ${totalApiCalls} API calls`);
    return;
  }

  await sendReport(env, reportLocality);
}

interface ScrapeResult {
  newLeads: number;
  apiCalls: number;
  quotaExhausted: boolean;
}

async function scrapeLocality(env: Env, locality: Locality): Promise<ScrapeResult> {
  const seen = new Set<string>();
  const businesses: BusinessInsert[] = [];
  let quotaExhausted = false;
  let apiCalls = 0;
  let failedCategories = 0;

  for (const category of CATEGORIES) {
    if (quotaExhausted) break;
    try {
      const { results: catResults, calls } = await searchCategory(env, locality, category);
      apiCalls += calls;
      for (const r of catResults) {
        if (seen.has(r.place_id)) continue;
        seen.add(r.place_id);

        const resolved = await resolveLocality(
          env.leadgen,
          r.address ?? null,
          r.gps_coordinates.latitude,
          r.gps_coordinates.longitude
        );
        const localityId = resolved?.id ?? locality.id;

        const slug = await generateUniqueSlug(r.title, localityId, env.leadgen);

        businesses.push({
          title: r.title,
          slug,
          phone: r.phone ?? null,
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
        });
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('429')) {
        console.error(`[scraper] quota exhausted at ${category}@${locality.name}`);
        quotaExhausted = true;
        break;
      }
      failedCategories++;
      console.error(`[scraper] ${category}@${locality.name}: ${err}`);
    }
  }

  await batchInsert(env.leadgen, businesses);
  console.log(`[scraper] ${locality.name}: ${businesses.length} biz, ${apiCalls} API calls, ${failedCategories} failed cats`);

  if (quotaExhausted) {
    console.log(`[scraper] marked searched despite quota exhaustion`);
  } else if (failedCategories > 0) {
    console.log(`[scraper] marked searched despite ${failedCategories} failed categories`);
  }

  const leadsResult = await env.leadgen.prepare(
    "SELECT COUNT(*) as cnt FROM businesses WHERE locality_id = ? AND website IS NULL AND phone IS NOT NULL AND created_at >= date('now')"
  ).bind(locality.id).first<{ cnt: number }>();

  return { newLeads: leadsResult?.cnt ?? 0, apiCalls, quotaExhausted };
}

async function sendReport(env: Env, locality: Locality): Promise<void> {
  const totalResult = await env.leadgen.prepare(
    "SELECT COUNT(*) as cnt FROM businesses WHERE locality_id = ? AND created_at >= date('now')"
  ).bind(locality.id).first<{ cnt: number }>();

  const leadsResult = await env.leadgen.prepare(
    "SELECT COUNT(*) as cnt FROM businesses WHERE locality_id = ? AND website IS NULL AND phone IS NOT NULL AND created_at >= date('now')"
  ).bind(locality.id).first<{ cnt: number }>();

  const topLeads = await env.leadgen.prepare(`
    SELECT title, category, phone FROM businesses
    WHERE locality_id = ? AND website IS NULL AND phone IS NOT NULL
      AND created_at >= date('now')
    ORDER BY id DESC LIMIT 5
  `).bind(locality.id).all<LeadSummary>();

  const stats: DailyReportStats = {
    locality_name: locality.name,
    total_businesses: totalResult?.cnt ?? 0,
    new_leads: leadsResult?.cnt ?? 0,
    top_leads: topLeads.results,
  };

  const sellers = await env.leadgen.prepare(
    'SELECT id, name, report_chat_id, token FROM sellers WHERE report_chat_id IS NOT NULL'
  ).all<SellerRow>();

  for (const seller of sellers.results) {
    try {
      await sendDailyReport(env.TG_SELLER_BOT_TOKEN, seller, stats);
    } catch (err) {
      console.log(`telegram: failed for seller ${seller.id}: ${err}`);
    }
  }
}

async function getNextLocality(db: D1Database): Promise<Locality | null> {
  return db
    .prepare(
      `SELECT * FROM localities
       WHERE searched_at IS NULL AND lat IS NOT NULL AND geocode_failed = 0
       ORDER BY distance_km LIMIT 1`
    )
    .first<Locality>();
}

async function batchInsert(db: D1Database, businesses: BusinessInsert[]): Promise<void> {
  for (let i = 0; i < businesses.length; i += BATCH_SIZE) {
    const chunk = businesses.slice(i, i + BATCH_SIZE);
    const placeholders = chunk
      .map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .join(', ');
    const values = chunk.flatMap((b) => [
      b.title, b.slug, b.phone, b.address, b.website,
      b.category, b.rating, b.gps_lat, b.gps_lng,
      b.place_id, b.data_cid, b.locality_id,
      b.reviews_count, b.google_type, b.google_types,
      b.description, b.operating_hours, b.thumbnail_url, b.unclaimed,
    ]);

    await db
      .prepare(
        `INSERT OR IGNORE INTO businesses
         (title, slug, phone, address, website, category, rating,
          gps_lat, gps_lng, place_id, data_cid, locality_id,
          reviews_count, google_type, google_types, description,
          operating_hours, thumbnail_url, unclaimed)
         VALUES ${placeholders}`
      )
      .bind(...values)
      .run();
  }
}

async function markSearched(db: D1Database, localityId: number): Promise<void> {
  await db
    .prepare(`UPDATE localities SET searched_at = datetime('now') WHERE id = ?`)
    .bind(localityId)
    .run();
}
