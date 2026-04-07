import { describe, it, expect } from 'vitest';
import { SerpApiError, serpApiErrorFromStatus } from './errors';

describe('serpApiErrorFromStatus', () => {
  it('maps 401 to kind "auth"', () => {
    expect(serpApiErrorFromStatus(401)).toBe('auth');
  });

  it('maps 402 to kind "payment"', () => {
    expect(serpApiErrorFromStatus(402)).toBe('payment');
  });

  it('maps 429 to kind "quota"', () => {
    expect(serpApiErrorFromStatus(429)).toBe('quota');
  });

  it('maps 503 to kind "server"', () => {
    expect(serpApiErrorFromStatus(503)).toBe('server');
  });

  it('maps 500 to kind "server"', () => {
    expect(serpApiErrorFromStatus(500)).toBe('server');
  });

  it('maps 418 to kind "unknown"', () => {
    expect(serpApiErrorFromStatus(418)).toBe('unknown');
  });

  it('maps 400 to kind "unknown"', () => {
    expect(serpApiErrorFromStatus(400)).toBe('unknown');
  });
});

describe('SerpApiError', () => {
  it('stores kind from constructor opts', () => {
    const err = new SerpApiError('boom', { kind: 'auth', status: 401, calls: 3 });
    expect(err.kind).toBe('auth');
    expect(err.status).toBe(401);
    expect(err.calls).toBe(3);
    expect(err.message).toBe('boom');
  });
});
