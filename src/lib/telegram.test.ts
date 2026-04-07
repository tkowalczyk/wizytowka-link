import { describe, it, expect } from 'vitest';
import { formatCronSection, formatDailyReport } from './telegram';
import type { CronSummaryRow } from './cron-log';
import type { DailyReportStats } from './telegram';

const CRON_LABELS: Record<string, string> = {
  '0 * * * *': 'Geocoder',
  '0 8 * * *': 'Discovery',
  '*/5 * * * *': 'Generator',
};

function baseStats(overrides: Partial<DailyReportStats> = {}): DailyReportStats {
  return {
    locality_name: 'Kraków',
    total_businesses: 0,
    new_leads: 0,
    top_leads: [],
    cronSection: '\n<b>Stan cron (24h):</b>\n\u2705 <b>Discovery</b>: 1 uruchomien',
    ...overrides,
  };
}

const SELLER = { token: 'tok_test' };
const DATE = '2026-04-07';

describe('formatCronSection', () => {
  it('returns empty string when no stats', () => {
    expect(formatCronSection([], CRON_LABELS)).toBe('');
  });

  it('formats a healthy run as checkmark line', () => {
    const stats: CronSummaryRow[] = [
      { cron_pattern: '0 * * * *', total_runs: 24, completed: 24, failed: 0, total_processed: 500, total_failed_items: 3 },
    ];

    const result = formatCronSection(stats, CRON_LABELS);

    expect(result).toContain('\u2705'); // ✅
    expect(result).toContain('Geocoder');
    expect(result).toContain('24 uruchomien');
    expect(result).toContain('500 przetworzonych');
  });

  it('formats a failed run with warning icon', () => {
    const stats: CronSummaryRow[] = [
      { cron_pattern: '0 8 * * *', total_runs: 1, completed: 0, failed: 1, total_processed: 0, total_failed_items: 0 },
    ];

    const result = formatCronSection(stats, CRON_LABELS);

    expect(result).toContain('\u274C'); // ❌
    expect(result).toContain('Discovery');
    expect(result).toContain('1 blad');
  });

  it('uses cron pattern as fallback label', () => {
    const stats: CronSummaryRow[] = [
      { cron_pattern: '0 12 * * *', total_runs: 1, completed: 1, failed: 0, total_processed: 5, total_failed_items: 0 },
    ];

    const result = formatCronSection(stats, CRON_LABELS);

    expect(result).toContain('0 12 * * *');
  });

  it('includes header', () => {
    const stats: CronSummaryRow[] = [
      { cron_pattern: '0 * * * *', total_runs: 1, completed: 1, failed: 0, total_processed: 10, total_failed_items: 0 },
    ];

    const result = formatCronSection(stats, CRON_LABELS);

    expect(result).toContain('Stan cron');
  });
});

describe('formatDailyReport', () => {
  it('renders quota-exhausted banner when flag set', () => {
    const result = formatDailyReport(SELLER, baseStats({ quotaExhausted: true }), DATE);

    expect(result).toContain('SerpAPI quota wyczerpane');
  });

  it('omits banner when quota flag is false', () => {
    const result = formatDailyReport(SELLER, baseStats({ quotaExhausted: false }), DATE);

    expect(result).not.toContain('SerpAPI quota wyczerpane');
  });

  it('renders banner before cron section', () => {
    const result = formatDailyReport(SELLER, baseStats({ quotaExhausted: true }), DATE);

    const bannerIdx = result.indexOf('SerpAPI quota wyczerpane');
    const cronIdx = result.indexOf('Stan cron');

    expect(bannerIdx).toBeGreaterThanOrEqual(0);
    expect(cronIdx).toBeGreaterThanOrEqual(0);
    expect(bannerIdx).toBeLessThan(cronIdx);
  });
});
