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

interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  date: number;
}

interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  first_name?: string;
  username?: string;
}

export interface SellerRow {
  id: number;
  name: string;
  telegram_chat_id: string | null;
  token: string;
}

export interface DailyReportStats {
  locality_name: string;
  total_businesses: number;
  new_leads: number;
  top_leads: LeadSummary[];
}

export interface LeadSummary {
  title: string;
  category: string | null;
  phone: string | null;
}

export async function sendMessage(
  env: Env,
  chatId: string,
  text: string
): Promise<TelegramSendMessageResponse> {
  const truncated = text.length > MAX_MESSAGE_LENGTH
    ? text.slice(0, MAX_MESSAGE_LENGTH - 3) + '...'
    : text;

  const res = await fetch(`${TG_API}${env.TG_BOT_TOKEN}/sendMessage`, {
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDailyReport(
  seller: SellerRow,
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
    `<a href="https://wizytowka.link/s/${seller.token}">Otworz panel \u2192</a>`,
  ].filter(Boolean).join('\n');
}

export async function sendDailyReport(
  env: Env,
  seller: SellerRow,
  stats: DailyReportStats
): Promise<void> {
  if (!seller.telegram_chat_id) return;

  const date = new Date().toISOString().slice(0, 10);
  const text = formatDailyReport(seller, stats, date);

  await sendMessage(env, seller.telegram_chat_id, text);
}
