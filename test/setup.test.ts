import { env } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, TEST_IDS } from './seed';

describe('test scaffold', () => {
  beforeEach(async () => {
    await resetDb(env.leadgen);
  });

  it('D1 bindings available', () => {
    expect(env.leadgen).toBeDefined();
  });

  it('R2 bindings available', () => {
    expect(env.sites).toBeDefined();
  });

  it('seed data: localities', async () => {
    const r = await env.leadgen.prepare('SELECT COUNT(*) as cnt FROM localities').first<{ cnt: number }>();
    expect(r?.cnt).toBe(4);
  });

  it('seed data: businesses', async () => {
    const r = await env.leadgen.prepare('SELECT COUNT(*) as cnt FROM businesses').first<{ cnt: number }>();
    expect(r?.cnt).toBe(6);
  });

  it('seed data: leads (no website, has phone)', async () => {
    const r = await env.leadgen.prepare(
      'SELECT COUNT(*) as cnt FROM businesses WHERE website IS NULL AND phone IS NOT NULL'
    ).first<{ cnt: number }>();
    expect(r?.cnt).toBe(5);
  });

  it('seed data: sellers', async () => {
    const r = await env.leadgen.prepare('SELECT COUNT(*) as cnt FROM sellers').first<{ cnt: number }>();
    expect(r?.cnt).toBe(2);
  });

  it('seed data: call_log', async () => {
    const r = await env.leadgen.prepare('SELECT COUNT(*) as cnt FROM call_log').first<{ cnt: number }>();
    expect(r?.cnt).toBe(4);
  });

  it('seed data: business_owners', async () => {
    const r = await env.leadgen.prepare('SELECT COUNT(*) as cnt FROM business_owners').first<{ cnt: number }>();
    expect(r?.cnt).toBe(2);
  });

  it('R2 put and get', async () => {
    const key = 'sites/krakow/test.json';
    const data = JSON.stringify({ hero: { headline: 'Test' } });
    await env.sites.put(key, data, { httpMetadata: { contentType: 'application/json' } });
    const obj = await env.sites.get(key);
    expect(obj).not.toBeNull();
    const body = await obj!.json();
    expect(body).toEqual({ hero: { headline: 'Test' } });
  });

  it('ROW_NUMBER: latest call_log per business', async () => {
    const r = await env.leadgen.prepare(`
      SELECT status FROM (
        SELECT status, ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY created_at DESC) as rn
        FROM call_log WHERE seller_id = ? AND business_id = ?
      ) WHERE rn = 1
    `).bind(TEST_IDS.sellers.jan, TEST_IDS.businesses.hydraulikWarszawa).first<{ status: string }>();
    expect(r?.status).toBe('interested');
  });
});
