const BATCH_SIZE = 800;
const SLEEP_MS = 1100;
const WALL_TIME_LIMIT_MS = 25 * 60 * 1000;
const START_LAT = 52.3547;
const START_LON = 21.0822;
const USER_AGENT = 'LeadGen/1.0 (kontakt@wizytowka.link)';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

interface NominatimResult {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  class: string;
  type: string;
  place_rank: number;
  importance: number;
  addresstype: string;
  name: string;
  display_name: string;
  boundingbox: string[];
}

interface GeoResult {
  lat: number;
  lon: number;
  nominatim_place_id: number;
  osm_type: string;
  osm_id: number;
  nominatim_type: string;
  place_rank: number;
  address_type: string;
  bbox: string;
}

interface LocalityRow {
  id: number;
  name: string;
  woj_name: string;
  pow_name: string;
  gmi_name: string;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchCoords(loc: LocalityRow): Promise<GeoResult | null> {
  const q = `${loc.name}, ${loc.gmi_name}, ${loc.pow_name}, ${loc.woj_name}, Polska`;
  const url = `${NOMINATIM_URL}?${new URLSearchParams({
    q,
    format: 'json',
    limit: '1',
  })}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (res.status === 429) throw new Error('RATE_LIMITED');
  if (!res.ok) throw new Error(`HTTP_${res.status}`);

  const data = (await res.json()) as NominatimResult[];
  if (!data.length) return null;

  const lat = parseFloat(data[0].lat);
  const lon = parseFloat(data[0].lon);
  if (isNaN(lat) || isNaN(lon)) return null;
  return {
    lat,
    lon,
    nominatim_place_id: data[0].place_id,
    osm_type: data[0].osm_type,
    osm_id: data[0].osm_id,
    nominatim_type: data[0].type,
    place_rank: data[0].place_rank,
    address_type: data[0].addresstype,
    bbox: JSON.stringify(data[0].boundingbox),
  };
}

export async function geocodeLocalities(env: Env): Promise<void> {
  const { results } = await env.leadgen.prepare(
    `SELECT id, name, woj_name, pow_name, gmi_name
     FROM localities
     WHERE lat IS NULL AND geocode_failed = 0
     ORDER BY id
     LIMIT ?`
  ).bind(BATCH_SIZE).all<LocalityRow>();

  if (!results.length) {
    console.log('geocoder: nothing to process');
    return;
  }

  let processed = 0;
  let failed = 0;
  const startTime = Date.now();

  for (const loc of results) {
    if (Date.now() - startTime > WALL_TIME_LIMIT_MS) {
      console.log(`geocoder: wall-time limit reached after ${processed} localities`);
      break;
    }
    try {
      let coords = await fetchCoords(loc);

      // fallback: shorter query with just name + voivodeship
      if (!coords) {
        await sleep(SLEEP_MS);
        const fallbackQ = `${loc.name}, ${loc.woj_name}, Polska`;
        const fallbackUrl = `${NOMINATIM_URL}?${new URLSearchParams({
          q: fallbackQ,
          format: 'json',
          limit: '1',
        })}`;
        const fallbackRes = await fetch(fallbackUrl, {
          headers: { 'User-Agent': USER_AGENT },
        });
        if (fallbackRes.ok) {
          const fallbackData = (await fallbackRes.json()) as NominatimResult[];
          if (fallbackData.length) {
            const fbLat = parseFloat(fallbackData[0].lat);
            const fbLon = parseFloat(fallbackData[0].lon);
            if (!isNaN(fbLat) && !isNaN(fbLon)) {
              coords = {
                lat: fbLat,
                lon: fbLon,
                nominatim_place_id: fallbackData[0].place_id,
                osm_type: fallbackData[0].osm_type,
                osm_id: fallbackData[0].osm_id,
                nominatim_type: fallbackData[0].type,
                place_rank: fallbackData[0].place_rank,
                address_type: fallbackData[0].addresstype,
                bbox: JSON.stringify(fallbackData[0].boundingbox),
              };
            }
          }
        }
        await sleep(SLEEP_MS);
      }

      if (!coords) {
        await env.leadgen.prepare(
          `UPDATE localities SET geocode_failed = 1 WHERE id = ?`
        ).bind(loc.id).run();
        failed++;
      } else {
        const dist = haversine(START_LAT, START_LON, coords.lat, coords.lon);
        await env.leadgen.prepare(
          `UPDATE localities
           SET lat = ?, lng = ?, distance_km = ?,
               nominatim_place_id = ?, osm_type = ?, osm_id = ?,
               nominatim_type = ?, place_rank = ?, address_type = ?, bbox = ?
           WHERE id = ?`
        ).bind(
          coords.lat, coords.lon, Math.round(dist * 100) / 100,
          coords.nominatim_place_id, coords.osm_type, coords.osm_id,
          coords.nominatim_type, coords.place_rank, coords.address_type, coords.bbox,
          loc.id
        ).run();
        processed++;
      }

      await sleep(SLEEP_MS);
    } catch (err) {
      if (err instanceof Error && err.message === 'RATE_LIMITED') {
        console.log(`geocoder: rate limited after ${processed} localities, stopping`);
        break;
      }
      console.log(`geocoder: error for ${loc.name} (${loc.id}): ${err}`);
      await sleep(SLEEP_MS);
    }
  }

  const remaining = await env.leadgen.prepare(
    `SELECT COUNT(*) as cnt FROM localities WHERE lat IS NULL AND geocode_failed = 0`
  ).first<{ cnt: number }>();

  console.log(`geocoder: processed=${processed} failed=${failed} remaining=${remaining?.cnt}`);
}
