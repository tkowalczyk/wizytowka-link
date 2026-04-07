export class SerpApiError extends Error {
  readonly calls: number;
  readonly status?: number;

  constructor(message: string, opts: { calls: number; status?: number }) {
    super(message);
    this.name = 'SerpApiError';
    this.calls = opts.calls;
    this.status = opts.status;
  }
}
