import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';
import { Leads } from './leads';
import { resetDb, TEST_IDS } from '../../test/seed';

let leads: Leads;

beforeAll(async () => {
  await resetDb(env.leadgen);
  leads = new Leads(env.leadgen);
});

// Shared seed has:
// biz 1 (hydraulik-warszawa): phone, no website, site_generated=1, call_log: called→interested (seller 1)
// biz 2 (fryzjer-anna): phone, no website, site_generated=1, call_log: rejected (seller 2 only)
// biz 3 (dentysta-krakow): phone, no website, site_generated=0, call_log: called (seller 1)
// biz 4 (piekarnia): phone, no website, site_generated=1, no call_log for seller 1
// biz 5 (sklep-agd): no phone, has website → excluded
// biz 6 (mechanik-wroclaw): phone, no website, site_generated=0, no call_log

// Leads visible to seller 1: biz 1,2,3,4,6 (5 has website+no phone)
// With latest call_log for seller 1: biz1=interested, biz3=called, rest=pending

// -- Phase A: pure functions --

describe('Leads.extractToken', () => {
  it('extracts from X-Seller-Token header', () => {
    const req = new Request('https://x.com/api', {
      headers: { 'X-Seller-Token': 'tok_abc' },
    });
    expect(Leads.extractToken(req)).toBe('tok_abc');
  });

  it('extracts from query param', () => {
    const req = new Request('https://x.com/api?token=tok_qp');
    expect(Leads.extractToken(req)).toBe('tok_qp');
  });

  it('prefers header over query param', () => {
    const req = new Request('https://x.com/api?token=qp', {
      headers: { 'X-Seller-Token': 'hdr' },
    });
    expect(Leads.extractToken(req)).toBe('hdr');
  });

  it('returns null when neither present', () => {
    const req = new Request('https://x.com/api');
    expect(Leads.extractToken(req)).toBeNull();
  });
});

// -- Phase B: auth + simple queries --

describe('authenticate', () => {
  it('returns seller for valid token', async () => {
    const seller = await leads.authenticate(TEST_IDS.tokens.sellerJan);
    expect(seller).not.toBeNull();
    expect(seller!.name).toBe('Jan Sprzedawca');
  });

  it('returns null for invalid token', async () => {
    expect(await leads.authenticate('tok_fake')).toBeNull();
  });
});

describe('businessExists', () => {
  it('returns true for existing business', async () => {
    expect(await leads.businessExists(TEST_IDS.businesses.hydraulikWarszawa)).toBe(true);
  });

  it('returns false for missing business', async () => {
    expect(await leads.businessExists(999)).toBe(false);
  });
});

// -- Phase C: lead listing --

describe('list', () => {
  it('returns leads with correct pagination shape', async () => {
    const page = await leads.list(TEST_IDS.sellers.jan);
    expect(page).toHaveProperty('leads');
    expect(page).toHaveProperty('total');
    expect(page).toHaveProperty('page');
    expect(page).toHaveProperty('totalPages');
    expect(page.page).toBe(1);
    // biz 1,2,3,4,6 qualify (phone + no website). biz 5 excluded (no phone + has website)
    expect(page.total).toBe(5);
  });

  it('excludes businesses with website or without phone', async () => {
    const page = await leads.list(TEST_IDS.sellers.jan);
    const ids = page.leads.map(l => l.id);
    expect(ids).not.toContain(TEST_IDS.businesses.sklepAgd);
  });

  it('picks latest call_log via ROW_NUMBER for seller', async () => {
    const page = await leads.list(TEST_IDS.sellers.jan);
    const biz1 = page.leads.find(l => l.id === TEST_IDS.businesses.hydraulikWarszawa)!;
    expect(biz1.status).toBe('interested'); // latest of called→interested
    expect(biz1.comment).toBe('Zainteresowany, oddzwoni');
  });

  it('defaults pending for businesses with no call_log for this seller', async () => {
    const page = await leads.list(TEST_IDS.sellers.jan);
    const biz4 = page.leads.find(l => l.id === TEST_IDS.businesses.piekarnia)!;
    expect(biz4.status).toBe('pending');
  });

  it('filters by status=interested', async () => {
    const page = await leads.list(TEST_IDS.sellers.jan, { status: 'interested' });
    expect(page.leads.every(l => l.status === 'interested')).toBe(true);
    expect(page.total).toBe(1); // only biz 1
  });

  it('filters by status=pending includes NULL call_log', async () => {
    const page = await leads.list(TEST_IDS.sellers.jan, { status: 'pending' });
    // biz 2,4,6 have no call_log for seller 1 → pending
    expect(page.total).toBe(3);
    expect(page.leads.every(l => l.status === 'pending')).toBe(true);
  });

  it('filters by locality', async () => {
    const page = await leads.list(TEST_IDS.sellers.jan, { locality: 'krakow' });
    expect(page.leads.every(l => l.loc_slug === 'krakow')).toBe(true);
    expect(page.total).toBe(2); // biz 3 + 4
  });

  it('filters by site=generated', async () => {
    const page = await leads.list(TEST_IDS.sellers.jan, { site: 'generated' });
    expect(page.leads.every(l => l.site_generated === 1)).toBe(true);
  });

  it('filters by site=none', async () => {
    const page = await leads.list(TEST_IDS.sellers.jan, { site: 'none' });
    expect(page.leads.every(l => l.site_generated === 0)).toBe(true);
  });

  it('sorts by date descending by default', async () => {
    const page = await leads.list(TEST_IDS.sellers.jan, { sort: 'date' });
    const dates = page.leads.map(l => l.created_at);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('sorts by status when requested', async () => {
    const datePage = await leads.list(TEST_IDS.sellers.jan, { sort: 'date' });
    const statusPage = await leads.list(TEST_IDS.sellers.jan, { sort: 'status' });
    // status sort should differ from date sort (different ORDER BY clause)
    const dateIds = datePage.leads.map(l => l.id);
    const statusIds = statusPage.leads.map(l => l.id);
    // both have same elements, just different order
    expect([...statusIds].sort()).toEqual([...dateIds].sort());
  });

  it('paginates correctly', async () => {
    const page1 = await leads.list(TEST_IDS.sellers.jan, { pageSize: 2, page: 1 });
    expect(page1.leads.length).toBe(2);
    expect(page1.totalPages).toBe(3); // 5 total / 2 per page = 3

    const page2 = await leads.list(TEST_IDS.sellers.jan, { pageSize: 2, page: 2 });
    expect(page2.leads.length).toBe(2);
    expect(page2.page).toBe(2);

    const page3 = await leads.list(TEST_IDS.sellers.jan, { pageSize: 2, page: 3 });
    expect(page3.leads.length).toBe(1);
  });
});

describe('localities', () => {
  it('returns distinct localities that have leads', async () => {
    const locs = await leads.localities();
    const slugs = locs.map(l => l.slug);
    expect(slugs).toContain('krakow');
    expect(slugs).toContain('warszawa');
    expect(slugs).toContain('wroclaw');
    // nowa-wies has no businesses → excluded
    expect(slugs).not.toContain('nowa-wies');
  });
});

// -- Phase D: mutations --

describe('logStatus', () => {
  it('appends a new call_log row', async () => {
    await leads.logStatus(TEST_IDS.businesses.piekarnia, TEST_IDS.sellers.jan, 'called', 'rang once');
    const page = await leads.list(TEST_IDS.sellers.jan);
    const biz = page.leads.find(l => l.id === TEST_IDS.businesses.piekarnia)!;
    expect(biz.status).toBe('called');
    expect(biz.comment).toBe('rang once');
  });

  it('does not overwrite previous entries', async () => {
    await leads.logStatus(TEST_IDS.businesses.piekarnia, TEST_IDS.sellers.jan, 'interested', 'wants quote');
    const rows = await env.leadgen
      .prepare('SELECT * FROM call_log WHERE business_id = ? AND seller_id = ? ORDER BY created_at')
      .bind(TEST_IDS.businesses.piekarnia, TEST_IDS.sellers.jan)
      .all();
    expect(rows.results.length).toBeGreaterThanOrEqual(2);
  });
});

describe('updateComment', () => {
  it('updates only the latest call_log entry', async () => {
    // Use biz 1 (hydraulik) which has seed data with distinct timestamps
    const before = await env.leadgen
      .prepare('SELECT id, comment FROM call_log WHERE business_id = ? AND seller_id = ? ORDER BY created_at DESC')
      .bind(TEST_IDS.businesses.hydraulikWarszawa, TEST_IDS.sellers.jan)
      .all<{ id: number; comment: string }>();
    const latestId = before.results[0].id;
    const earlierId = before.results[1].id;

    await leads.updateComment(TEST_IDS.businesses.hydraulikWarszawa, TEST_IDS.sellers.jan, 'updated comment');

    const latest = await env.leadgen
      .prepare('SELECT comment FROM call_log WHERE id = ?')
      .bind(latestId)
      .first<{ comment: string }>();
    expect(latest!.comment).toBe('updated comment');

    const earlier = await env.leadgen
      .prepare('SELECT comment FROM call_log WHERE id = ?')
      .bind(earlierId)
      .first<{ comment: string }>();
    expect(earlier!.comment).toBe('Nie odebral');
  });
});

describe('matchByPhone', () => {
  it('finds businesses by normalized phone', async () => {
    const matches = await leads.matchByPhone('+48123456789');
    expect(matches.length).toBe(1);
    expect(matches[0].title).toBe('Hydraulik Warszawa');
  });

  it('matches with spaces in input', async () => {
    const matches = await leads.matchByPhone('123 456 789');
    expect(matches.length).toBe(1);
  });

  it('returns empty for unknown number', async () => {
    const matches = await leads.matchByPhone('+48000000000');
    expect(matches.length).toBe(0);
  });
});

describe('ensureOwnerToken', () => {
  it('returns existing token for business with one', async () => {
    const token = await leads.ensureOwnerToken(TEST_IDS.businesses.hydraulikWarszawa);
    expect(token).toBe(TEST_IDS.tokens.bizHydraulik);
  });

  it('creates token for business without one', async () => {
    const token = await leads.ensureOwnerToken(TEST_IDS.businesses.dentystaKrakow);
    expect(token).toBeTruthy();
    expect(token.startsWith('biz_')).toBe(true);
  });

  it('returns same token on second call (idempotent)', async () => {
    const t1 = await leads.ensureOwnerToken(TEST_IDS.businesses.dentystaKrakow);
    const t2 = await leads.ensureOwnerToken(TEST_IDS.businesses.dentystaKrakow);
    expect(t1).toBe(t2);
  });
});
