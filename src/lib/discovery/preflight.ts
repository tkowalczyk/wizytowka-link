import type { StatePort } from './ports';
import type { AccountHealth } from '../serpapi/account';
import { fetchSerpApiAccount } from '../serpapi/account';

export const SKIP_FLAG_KEY = 'skip_discovery';
export const SKIP_TTL_SECONDS = 90 * 60;
export const DEFAULT_MIN_QUOTA = 200;

export interface PreflightDeps {
  fetchAccount: () => Promise<AccountHealth>;
  state: StatePort;
  threshold: number;
}

export interface PreflightResult {
  processed: number;
  failed: number;
  meta: {
    searchesLeft: number | null;
    skip: boolean;
    threshold: number;
    reason?: string;
  };
}

export async function preflightDiscovery(deps: PreflightDeps): Promise<PreflightResult> {
  const acc = await deps.fetchAccount();
  const searchesLeft = acc.searches_left;
  let skip = false;
  let reason: string | undefined;

  if (acc.status === 'error' || searchesLeft == null) {
    // fail-open: nie wiemy ile mamy → pozwól discovery spróbować
    reason = 'fetch-failed';
  } else if (searchesLeft < deps.threshold) {
    skip = true;
    await deps.state.put(
      SKIP_FLAG_KEY,
      JSON.stringify({ searchesLeft, threshold: deps.threshold, setAt: new Date().toISOString() }),
      { ttlSeconds: SKIP_TTL_SECONDS },
    );
  }

  return {
    processed: 0,
    failed: 0,
    meta: {
      searchesLeft,
      skip,
      threshold: deps.threshold,
      ...(reason ? { reason } : {}),
    },
  };
}

// -- KV adapter + Worker entrypoint --

export function kvStatePort(kv: KVNamespace): StatePort {
  return {
    async get(key) {
      return kv.get(key);
    },
    async put(key, value, opts) {
      await kv.put(key, value, opts?.ttlSeconds ? { expirationTtl: opts.ttlSeconds } : undefined);
    },
    async delete(key) {
      await kv.delete(key);
    },
  };
}

export function createPreflightDeps(env: Env): PreflightDeps {
  const thresholdRaw = env.DISCOVERY_MIN_QUOTA;
  const threshold = thresholdRaw ? Number(thresholdRaw) : DEFAULT_MIN_QUOTA;
  return {
    fetchAccount: () => fetchSerpApiAccount(env.SERP_API_KEY, { fetch }),
    state: kvStatePort(env.STATE),
    threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_MIN_QUOTA,
  };
}

export async function runPreflight(env: Env): Promise<PreflightResult> {
  return preflightDiscovery(createPreflightDeps(env));
}
