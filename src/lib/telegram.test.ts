import { describe, it, expect } from 'vitest';
import { formatCronSection } from './telegram';
import type { CronSummaryRow } from './cron-log';

const CRON_LABELS: Record<string, string> = {
  '0 * * * *': 'Geocoder',
  '0 8 * * *': 'Discovery',
  '*/5 * * * *': 'Generator',
};

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
