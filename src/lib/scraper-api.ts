import type { SerpApiLocalResult, SerpApiMapsResponse } from '../types/serpapi';
import type { Locality } from '../types/business';

const SERPAPI_BASE = 'https://serpapi.com/search.json';
const MAX_PAGES_PER_CATEGORY = 5;

export interface SearchCategoryResult {
  results: SerpApiLocalResult[];
  calls: number;
}

export async function searchCategory(
  env: Env,
  locality: Locality,
  category: string
): Promise<SearchCategoryResult> {
  const results: SerpApiLocalResult[] = [];
  let url: string | null = buildInitialUrl(env, locality, category);
  let page = 0;
  let calls = 0;

  while (url && page < MAX_PAGES_PER_CATEGORY) {
    const res = await fetch(url);
    calls++;
    if (res.status === 429) throw new Error('SerpAPI 429 quota exhausted');
    if (!res.ok) throw new Error(`SerpAPI ${res.status}`);

    const data: SerpApiMapsResponse = await res.json();

    if (data.local_results) {
      results.push(...data.local_results);
    }

    const next = data.serpapi_pagination?.next ?? null;
    url = next ? `${next}&api_key=${env.SERP_API_KEY}` : null;
    page++;
  }

  return { results, calls };
}

function buildInitialUrl(env: Env, loc: Locality, category: string): string {
  const q = encodeURIComponent(`${category} ${loc.name}`);
  return `${SERPAPI_BASE}?engine=google_maps&q=${q}&ll=@${loc.lat},${loc.lng},14z&api_key=${env.SERP_API_KEY}`;
}
