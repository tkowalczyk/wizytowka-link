export const WARNING_THRESHOLD = 500;
export const CRITICAL_THRESHOLD = 100;
export const TIMEOUT_MS = 5000;
export const CACHE_TTL_SECONDS = 300;
export const CACHE_KEY = 'serpapi-account-v1';

const ACCOUNT_URL = 'https://serpapi.com/account.json';

export type AccountHealthStatus = 'ok' | 'warning' | 'critical' | 'error';

export interface AccountHealth {
  plan: string | null;
  searches_left: number | null;
  plan_searches_left: number | null;
  plan_monthly_price: number | null;
  last_hour_searches: number | null;
  status: AccountHealthStatus;
  error?: string;
  checked_at: string;
}

export interface AccountDeps {
  fetch: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

export interface CachePort {
  get(key: string): Promise<AccountHealth | null>;
  set(key: string, value: AccountHealth, ttlSeconds: number): Promise<void>;
}

export interface CachedAccountDeps extends AccountDeps {
  cache: CachePort;
}

interface SerpApiAccountResponse {
  plan_id?: string | null;
  total_searches_left?: number | null;
  plan_searches_left?: number | null;
  plan_monthly_price?: number | null;
  this_hour_searches?: number | null;
}

function classify(searchesLeft: number): AccountHealthStatus {
  if (searchesLeft < CRITICAL_THRESHOLD) return 'critical';
  if (searchesLeft < WARNING_THRESHOLD) return 'warning';
  return 'ok';
}

function redactKey(msg: string, apiKey: string): string {
  if (!apiKey) return msg;
  return msg.split(apiKey).join('[REDACTED]');
}

function emptyHealth(checkedAt: string, status: AccountHealthStatus, error?: string): AccountHealth {
  return {
    plan: null,
    searches_left: null,
    plan_searches_left: null,
    plan_monthly_price: null,
    last_hour_searches: null,
    status,
    ...(error ? { error } : {}),
    checked_at: checkedAt,
  };
}

export async function fetchSerpApiAccount(
  apiKey: string,
  deps: AccountDeps,
): Promise<AccountHealth> {
  const now = deps.now ?? (() => new Date());
  const checkedAt = now().toISOString();
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await deps.fetch(`${ACCOUNT_URL}?api_key=${apiKey}`, {
      signal: controller.signal,
    });
  } catch (err) {
    const rawMsg =
      err instanceof Error && err.name === 'AbortError'
        ? `SerpAPI timeout after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    return emptyHealth(checkedAt, 'error', redactKey(rawMsg, apiKey));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    return emptyHealth(checkedAt, 'error', `SerpAPI HTTP ${res.status}`);
  }

  const data = (await res.json()) as SerpApiAccountResponse;
  const searchesLeft = data.total_searches_left ?? 0;

  return {
    plan: data.plan_id ?? null,
    searches_left: data.total_searches_left ?? null,
    plan_searches_left: data.plan_searches_left ?? null,
    plan_monthly_price: data.plan_monthly_price ?? null,
    last_hour_searches: data.this_hour_searches ?? null,
    status: classify(searchesLeft),
    checked_at: checkedAt,
  };
}

export async function getCachedAccountHealth(
  apiKey: string,
  deps: CachedAccountDeps,
): Promise<AccountHealth> {
  const cached = await deps.cache.get(CACHE_KEY);
  if (cached) return cached;

  const fresh = await fetchSerpApiAccount(apiKey, deps);
  // don't cache transient error states — we want fresh retry on next call
  if (fresh.status !== 'error') {
    await deps.cache.set(CACHE_KEY, fresh, CACHE_TTL_SECONDS);
  }
  return fresh;
}
