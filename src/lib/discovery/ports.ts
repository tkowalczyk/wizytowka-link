import type { Locality } from '../../types/business';
import type { SerpApiLocalResult } from '../../types/serpapi';

export interface SearchPort {
  search(
    locality: Locality,
    category: string,
  ): Promise<{ results: SerpApiLocalResult[]; calls: number }>;
}

export interface NotifyPort {
  reportToSellers(stats: DiscoveryStats): Promise<void>;
}

export interface DiscoveryDeps {
  db: D1Database;
  searchApi: SearchPort;
  notify: NotifyPort;
  categories: string[];
}

export interface LocalityStats {
  name: string;
  businesses: number;
  apiCalls: number;
  newLeads: number;
}

export interface DiscoveryStats {
  localities: LocalityStats[];
  totalApiCalls: number;
  totalBusinesses: number;
  totalNewLeads: number;
  quotaExhausted: boolean;
}
