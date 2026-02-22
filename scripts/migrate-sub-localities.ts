import { execSync } from "node:child_process";

const DB_NAME = "leadgen";

interface SubBusiness {
  biz_id: number;
  biz_slug: string;
  biz_lat: number;
  biz_lng: number;
  site_generated: number;
  loc_id: number;
  loc_slug: string;
  loc_lat: number | null;
  loc_lng: number | null;
}

interface MainCandidate {
  id: number;
  slug: string;
  lat: number;
  lng: number;
}

interface SlugRow {
  slug: string;
}

function d1(sql: string): string {
  const escaped = sql.replace(/'/g, "'\\''");
  return execSync(
    `pnpm wrangler d1 execute ${DB_NAME} --remote --yes --command='${escaped}'`,
    { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
  );
}

function d1Json<T>(sql: string): T[] {
  const raw = d1(sql);
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  const parsed = JSON.parse(match[0]);
  if (Array.isArray(parsed) && parsed[0]?.results) {
    return parsed[0].results as T[];
  }
  return parsed as T[];
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function main() {
  console.log("Fetching businesses on SUB localities...");
  const subs = d1Json<SubBusiness>(`
    SELECT b.id as biz_id, b.slug as biz_slug, b.gps_lat as biz_lat, b.gps_lng as biz_lng,
           b.site_generated, l.id as loc_id, l.slug as loc_slug, l.lat as loc_lat, l.lng as loc_lng
    FROM businesses b
    JOIN localities l ON b.locality_id = l.id
    WHERE l.sym <> l.sym_pod
  `);

  console.log(`Found ${subs.length} businesses on SUB localities`);
  if (!subs.length) {
    console.log("No businesses to migrate. Deleting SUB localities...");
    d1("DELETE FROM localities WHERE sym <> sym_pod");
    console.log("Done.");
    return;
  }

  let migrated = 0;
  let failed = 0;

  for (const biz of subs) {
    const lat = biz.biz_lat ?? biz.loc_lat;
    const lng = biz.biz_lng ?? biz.loc_lng;

    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
      console.warn(`  SKIP biz ${biz.biz_id} (${biz.biz_slug}): no GPS coords available`);
      failed++;
      continue;
    }

    const BBOX = 0.15;

    let candidates = d1Json<MainCandidate>(`
      SELECT id, slug, lat, lng FROM localities
      WHERE sym = sym_pod AND lat IS NOT NULL
        AND lat BETWEEN ${lat - BBOX} AND ${lat + BBOX}
        AND lng BETWEEN ${lng - BBOX} AND ${lng + BBOX}
    `);

    if (!candidates.length) {
      const WIDE = 0.5;
      candidates = d1Json<MainCandidate>(`
        SELECT id, slug, lat, lng FROM localities
        WHERE sym = sym_pod AND lat IS NOT NULL
          AND lat BETWEEN ${lat - WIDE} AND ${lat + WIDE}
          AND lng BETWEEN ${lng - WIDE} AND ${lng + WIDE}
      `);
    }

    if (!candidates.length) {
      console.warn(`  SKIP biz ${biz.biz_id} (${biz.biz_slug}): no MAIN locality found nearby`);
      failed++;
      continue;
    }

    let best = candidates[0];
    let bestDist = haversine(lat, lng, best.lat, best.lng);
    for (let i = 1; i < candidates.length; i++) {
      const d = haversine(lat, lng, candidates[i].lat, candidates[i].lng);
      if (d < bestDist) {
        bestDist = d;
        best = candidates[i];
      }
    }

    // check slug uniqueness in target locality
    let newSlug = biz.biz_slug;
    const existing = d1Json<SlugRow>(
      `SELECT slug FROM businesses WHERE locality_id = ${best.id} AND slug = '${biz.biz_slug}'`
    );
    if (existing.length) {
      newSlug = `${biz.biz_slug}-2`;
    }

    // move R2 object if site generated
    if (biz.site_generated) {
      const oldKey = `sites/${biz.loc_slug}/${biz.biz_slug}.json`;
      const newKey = `sites/${best.slug}/${newSlug}.json`;
      try {
        execSync(
          `pnpm wrangler r2 object get leadgen-sites/${oldKey} --pipe > /tmp/r2-migrate.json`,
          { stdio: ["pipe", "pipe", "pipe"] }
        );
        execSync(
          `pnpm wrangler r2 object put leadgen-sites/${newKey} --file=/tmp/r2-migrate.json`,
          { stdio: ["pipe", "pipe", "pipe"] }
        );
        execSync(
          `pnpm wrangler r2 object delete leadgen-sites/${oldKey}`,
          { stdio: ["pipe", "pipe", "pipe"] }
        );
      } catch (e) {
        console.warn(`  WARN: R2 move failed for ${oldKey} -> ${newKey}`);
      }
    }

    // update business
    const slugUpdate = newSlug !== biz.biz_slug ? `, slug = '${newSlug}'` : "";
    d1(`UPDATE businesses SET locality_id = ${best.id}${slugUpdate} WHERE id = ${biz.biz_id}`);

    console.log(`  ${biz.biz_id} ${biz.biz_slug}: ${biz.loc_slug} -> ${best.slug} (${bestDist.toFixed(1)}km)`);
    migrated++;
  }

  console.log(`\nMigrated: ${migrated}, Failed: ${failed}`);

  console.log("Deleting SUB localities (without businesses)...");
  d1(`DELETE FROM localities WHERE sym <> sym_pod
      AND id NOT IN (SELECT DISTINCT locality_id FROM businesses)`);

  const remaining = d1Json<{ cnt: number }>("SELECT COUNT(*) as cnt FROM localities WHERE sym <> sym_pod");
  console.log(`SUB localities remaining: ${remaining[0]?.cnt ?? "?"}`);
  console.log("Done.");
}

main().catch(console.error);
