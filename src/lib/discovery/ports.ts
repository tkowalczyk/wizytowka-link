import type { Locality } from '../../types/business';
import type { SerpApiLocalResult } from '../../types/serpapi';
import type { SerpApiErrorKind } from './errors';

export type { SerpApiErrorKind };

export interface SearchPort {
  search(
    locality: Locality,
    category: string,
  ): Promise<{ results: SerpApiLocalResult[]; calls: number }>;
}

export interface NotifyPort {
  reportToSellers(stats: DiscoveryStats): Promise<void>;
}

export interface StatePort {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { ttlSeconds?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface DiscoveryDeps {
  db: D1Database;
  searchApi: SearchPort;
  notify: NotifyPort;
  categories: string[];
  state?: StatePort;
}

export interface LocalityStats {
  name: string;
  businesses: number;
  apiCalls: number;
  newLeads: number;
}

export type DiscoveryErrorKind = SerpApiErrorKind | 'preflight-skip';

export interface DiscoveryStats {
  localities: LocalityStats[];
  totalApiCalls: number;
  totalBusinesses: number;
  totalNewLeads: number;
  quotaExhausted: boolean;
  errorKind?: DiscoveryErrorKind | null;
  searchesLeft?: number | null;
}
