import type { BusinessInsert, Locality } from '../types/business';
import { searchCategory } from './scraper-api';
import { slugify } from './slug';
import { sendDailyReport } from './telegram';
import type { SellerRow, LeadSummary, DailyReportStats } from './telegram';

const CATEGORIES = [
  'firma', 'sklep', 'restauracja', 'hydraulik', 'elektryk',
  'mechanik', 'fryzjer', 'dentysta', 'weterynarz', 'kwiaciarnia',
  'piekarnia', 'zakład pogrzebowy', 'fotograf', 'księgowość',
  'fizjoterapia', 'przedszkole', 'autokomis', 'usługi',
] as const;

// D1 max 100 bound params; 12 cols = max 8 rows/batch
const BATCH_SIZE = 8;

export async function scrapeBusinesses(env: Env): Promise<void> {
  const locality = await getNextLocality(env.leadgen);
  if (!locality) return;

  const seen = new Set<string>();
  const businesses: BusinessInsert[] = [];
  let quotaExhausted = false;
  let apiCalls = 0;
  let failedCategories = 0;

  const { results: existingSlugs } = await env.leadgen
    .prepare(`SELECT slug FROM businesses WHERE locality_id = ?`)
    .bind(locality.id)
    .all<{ slug: string }>();
  const usedSlugs = new Set(existingSlugs.map(r => r.slug));

  for (const category of CATEGORIES) {
    if (quotaExhausted) break;
    try {
      const { results: catResults, calls } = await searchCategory(env, locality, category);
      apiCalls += calls;
      for (const r of catResults) {
        if (seen.has(r.place_id)) continue;
        seen.add(r.place_id);

        let slug = slugify(r.title);
        let suffix = 2;
        const base = slug;
        while (usedSlugs.has(slug)) {
          slug = `${base}-${suffix++}`;
        }
        usedSlugs.add(slug);

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
          locality_id: locality.id,
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
    console.log(`[scraper] skipping markSearched — quota exhausted`);
  } else if (failedCategories > 0) {
    console.log(`[scraper] markSearched despite ${failedCategories} failed categories — non-quota errors`);
    await markSearched(env.leadgen, locality.id);
  } else {
    await markSearched(env.leadgen, locality.id);
  }

  // --- Telegram daily report ---
  const totalResult = await env.leadgen.prepare(
    'SELECT COUNT(*) as cnt FROM businesses WHERE locality_id = ?'
  ).bind(locality.id).first<{ cnt: number }>();

  const leadsResult = await env.leadgen.prepare(
    'SELECT COUNT(*) as cnt FROM businesses WHERE locality_id = ? AND website IS NULL AND phone IS NOT NULL'
  ).bind(locality.id).first<{ cnt: number }>();

  const topLeads = await env.leadgen.prepare(`
    SELECT title, category, phone FROM businesses
    WHERE locality_id = ? AND website IS NULL AND phone IS NOT NULL
    ORDER BY id DESC LIMIT 5
  `).bind(locality.id).all<LeadSummary>();

  const stats: DailyReportStats = {
    locality_name: locality.name,
    total_businesses: totalResult?.cnt ?? 0,
    new_leads: leadsResult?.cnt ?? 0,
    top_leads: topLeads.results,
  };

  const sellers = await env.leadgen.prepare(
    'SELECT id, name, telegram_chat_id, token FROM sellers WHERE telegram_chat_id IS NOT NULL'
  ).all<SellerRow>();

  for (const seller of sellers.results) {
    try {
      await sendDailyReport(env, seller, stats);
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
      .map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .join(', ');
    const values = chunk.flatMap((b) => [
      b.title, b.slug, b.phone, b.address, b.website,
      b.category, b.rating, b.gps_lat, b.gps_lng,
      b.place_id, b.data_cid, b.locality_id,
    ]);

    await db
      .prepare(
        `INSERT OR IGNORE INTO businesses
         (title, slug, phone, address, website, category, rating,
          gps_lat, gps_lng, place_id, data_cid, locality_id)
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
