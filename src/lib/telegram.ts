import type { CronSummaryRow, RunResult } from './cron-log';
import type { SerpApiErrorKind } from './discovery/errors';

const TG_API = 'https://api.telegram.org/bot';
const MAX_MESSAGE_LENGTH = 4096;
const MAX_TOP_LEADS = 5;

interface TelegramSendMessageParams {
  chat_id: string;
  text: string;
  parse_mode: 'Markdown' | 'MarkdownV2' | 'HTML';
}

interface TelegramSendMessageResponse {
  ok: boolean;
  result?: TelegramMessage;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  date: number;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  first_name?: string;
  username?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number };
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface DailyReportStats {
  locality_name: string;
  total_businesses: number;
  new_leads: number;
  top_leads: LeadSummary[];
  cronSection?: string;
  quotaExhausted?: boolean;
  errorKind?: SerpApiErrorKind | null;
}

export interface LeadSummary {
  title: string;
  category: string | null;
  phone: string | null;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export async function sendMessage(
  token: string,
  chatId: string,
  text: string
): Promise<TelegramSendMessageResponse> {
  const truncated = text.length > MAX_MESSAGE_LENGTH
    ? text.slice(0, MAX_MESSAGE_LENGTH - 3) + '...'
    : text;

  const res = await fetch(`${TG_API}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: truncated,
      parse_mode: 'HTML',
    } satisfies TelegramSendMessageParams),
  });

  const data = await res.json() as TelegramSendMessageResponse;

  if (!data.ok) {
    if (data.error_code === 429) {
      const wait = data.parameters?.retry_after ?? 30;
      console.log(`telegram: rate limited, retry after ${wait}s`);
      return data;
    }
    console.log(`telegram: error ${data.error_code}: ${data.description}`);
  }

  return data;
}

export async function answerCallback(
  token: string,
  callbackId: string,
  text: string
): Promise<void> {
  await fetch(`${TG_API}${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
  });
}

export async function sendMessageWithKeyboard(
  token: string,
  chatId: string,
  text: string,
  keyboard: InlineKeyboardButton[][]
): Promise<void> {
  await fetch(`${TG_API}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    }),
  });
}

export async function sendChatAction(
  token: string,
  chatId: string,
  action: 'typing' | 'upload_photo' | 'upload_document' = 'typing'
): Promise<void> {
  await fetch(`${TG_API}${token}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action }),
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatCronSection(
  stats: CronSummaryRow[],
  labels: Record<string, string>
): string {
  if (!stats.length) return '';

  const lines = stats.map(s => {
    const label = labels[s.cron_pattern] ?? s.cron_pattern;
    const icon = s.failed > 0 ? '\u274C' : '\u2705';
    const parts = [`${icon} <b>${escapeHtml(label)}</b>: ${s.total_runs} uruchomien`];
    if (s.total_processed > 0) parts.push(`${s.total_processed} przetworzonych`);
    if (s.total_failed_items > 0) parts.push(`${s.total_failed_items} bledow pozycji`);
    if (s.failed > 0) parts.push(`${s.failed} blad${s.failed > 1 ? 'ow' : ''}`);
    return parts.join(', ');
  });

  return ['', '<b>Stan cron (24h):</b>', ...lines].join('\n');
}

const BANNER_BY_KIND: Record<SerpApiErrorKind, string | null> = {
  auth: '\n\uD83D\uDD34 <b>SerpAPI: klucz nieważny</b>',
  payment: '\n\uD83D\uDD34 <b>SerpAPI: brak płatności</b>',
  quota: '\n\u26A0\uFE0F <b>SerpAPI quota wyczerpane</b>',
  server: null,
  unknown: null,
};

function formatErrorBanner(stats: DailyReportStats): string {
  const kind = stats.errorKind ?? (stats.quotaExhausted ? 'quota' : null);
  if (!kind) return '';
  return BANNER_BY_KIND[kind] ?? '';
}

export function formatDailyReport(
  seller: { token: string },
  stats: DailyReportStats,
  date: string
): string {
  const leadsBlock = stats.top_leads
    .slice(0, MAX_TOP_LEADS)
    .map((l, i) => {
      const parts = [escapeHtml(l.title), l.category ? escapeHtml(l.category) : null, l.phone].filter(Boolean);
      return `${i + 1}. ${parts.join(' \u2014 ')}`;
    })
    .join('\n');

  const remaining = stats.new_leads - Math.min(stats.top_leads.length, MAX_TOP_LEADS);
  const moreLine = remaining > 0 ? `\n...i ${remaining} wiecej\n` : '';

  const errorBanner = formatErrorBanner(stats);

  return [
    `<b>Raport dzienny \u2014 ${date}</b>`,
    '',
    `Przeszukano: ${escapeHtml(stats.locality_name)}`,
    `Znaleziono firm: ${stats.total_businesses}`,
    `Nowych leadow (bez www): ${stats.new_leads}`,
    '',
    stats.new_leads > 0 ? '<b>Top leady:</b>' : '',
    leadsBlock,
    moreLine,
    errorBanner,
    stats.cronSection ?? '',
    `<a href="https://wizytowka.link/s/${seller.token}">Otworz panel \u2192</a>`,
  ].filter(Boolean).join('\n');
}

export async function sendDailyReport(
  token: string,
  seller: { report_chat_id: string | null; token: string },
  stats: DailyReportStats
): Promise<void> {
  if (!seller.report_chat_id) return;

  const date = new Date().toISOString().slice(0, 10);
  const text = formatDailyReport(seller, stats, date);

  await sendMessage(token, seller.report_chat_id, text);
}

// -- critical alerts --

export type CriticalAlertKind = 'auth' | 'payment' | 'quota';

export interface CriticalAlertResult {
  sent: boolean;
  recipients: number;
}

const ALERT_DEBOUNCE_HOURS = 6;

export async function sendCriticalAlert(
  env: Env,
  params: { kind: CriticalAlertKind; message: string }
): Promise<CriticalAlertResult> {
  const lastAlert = await env.leadgen
    .prepare(
      `SELECT sent_at FROM alert_log
       WHERE kind = ? AND sent_at > datetime('now', '-${ALERT_DEBOUNCE_HOURS} hours')
       ORDER BY sent_at DESC LIMIT 1`
    )
    .bind(params.kind)
    .first<{ sent_at: string }>();

  if (lastAlert) {
    return { sent: false, recipients: 0 };
  }

  const subscribers = await env.leadgen
    .prepare("SELECT notify_chat_id FROM sellers WHERE notify_chat_id IS NOT NULL")
    .all<{ notify_chat_id: string }>();

  let recipients = 0;
  for (const sub of subscribers.results) {
    try {
      await sendMessage(env.TG_NOTIFY_BOT_TOKEN, sub.notify_chat_id, params.message);
      recipients++;
    } catch (err) {
      console.log(`telegram: critical alert failed for chat ${sub.notify_chat_id}: ${err}`);
    }
  }

  await env.leadgen
    .prepare("INSERT INTO alert_log (kind) VALUES (?)")
    .bind(params.kind)
    .run();

  return { sent: true, recipients };
}

const ADMIN_PANEL_URL = 'https://wizytowka.link/s/REDACTED_TOKEN';

function formatCriticalAlertMessage(kind: CriticalAlertKind): string {
  return `\uD83D\uDEA8 SerpAPI: ${kind} \u2014 discovery zatrzymane. Panel: ${ADMIN_PANEL_URL}`;
}

export function dispatchCriticalAlert(
  env: Env,
  ctx: ExecutionContext,
  result: RunResult
): void {
  const meta = result.meta ?? {};
  const errorKind = meta.errorKind as SerpApiErrorKind | null | undefined;
  const quotaExhausted = meta.quotaExhausted === true;

  let kind: CriticalAlertKind | null = null;
  if (quotaExhausted) {
    kind = 'quota';
  } else if (errorKind === 'auth' || errorKind === 'payment' || errorKind === 'quota') {
    kind = errorKind;
  }

  if (!kind) return;

  const message = formatCriticalAlertMessage(kind);
  ctx.waitUntil(
    sendCriticalAlert(env, { kind, message }).catch((err) => {
      console.error(`[critical-alert] dispatch failed for kind=${kind}:`, err);
    })
  );
}
