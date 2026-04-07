export type SerpApiErrorKind = 'auth' | 'payment' | 'quota' | 'server' | 'unknown';

export function serpApiErrorFromStatus(status: number): SerpApiErrorKind {
  if (status === 401) return 'auth';
  if (status === 402) return 'payment';
  if (status === 429) return 'quota';
  if (status >= 500 && status <= 599) return 'server';
  return 'unknown';
}

export class SerpApiError extends Error {
  readonly kind: SerpApiErrorKind;
  readonly calls: number;
  readonly status?: number;

  constructor(message: string, opts: { kind?: SerpApiErrorKind; calls: number; status?: number }) {
    super(message);
    this.name = 'SerpApiError';
    this.calls = opts.calls;
    this.status = opts.status;
    this.kind = opts.kind ?? (opts.status != null ? serpApiErrorFromStatus(opts.status) : 'unknown');
  }
}
