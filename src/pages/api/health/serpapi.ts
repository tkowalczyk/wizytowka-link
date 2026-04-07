import type { APIRoute } from 'astro';
import { Leads } from '../../../lib/leads';
import {
  getCachedAccountHealth,
  CACHE_TTL_SECONDS,
  type AccountHealth,
  type CachePort,
} from '../../../lib/serpapi/account';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cacheRequest(key: string): Request {
  return new Request(`https://cache.internal/${key}`);
}

// Workaround: astro/tsconfigs/strict pulls in DOM lib where CacheStorage
// lacks the CF-specific `default` cache. The runtime does expose it.
const cfCache = (caches as unknown as { default: Cache }).default;

function createCfCache(): CachePort {
  return {
    async get(key) {
      const hit = await cfCache.match(cacheRequest(key));
      if (!hit) return null;
      try {
        return (await hit.json()) as AccountHealth;
      } catch {
        return null;
      }
    },
    async set(key, value, ttlSeconds) {
      const res = new Response(JSON.stringify(value), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${ttlSeconds}`,
        },
      });
      await cfCache.put(cacheRequest(key), res);
    },
  };
}

export const GET: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const leads = new Leads(env.leadgen);

  const token = Leads.extractToken(request);
  if (!token) return json({ error: 'brak tokenu' }, 401);

  const seller = await leads.authenticate(token);
  if (!seller) return json({ error: 'nieprawidlowy token' }, 401);

  const health = await getCachedAccountHealth(env.SERP_API_KEY, {
    fetch: (...args) => fetch(...args),
    cache: createCfCache(),
  });

  return new Response(JSON.stringify(health), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `private, max-age=${CACHE_TTL_SECONDS}`,
    },
  });
};
