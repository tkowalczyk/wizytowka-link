import type {
  TelegramUpdate,
  InlineKeyboardButton,
} from '../telegram';

export type {
  TelegramUpdate,
  TelegramMessage,
  TelegramChat,
  TelegramCallbackQuery,
  InlineKeyboardButton,
  DailyReportStats,
  LeadSummary,
} from '../telegram';

export interface TgContext {
  env: Env;
  token: string;
  chatId: string;
  update: TelegramUpdate;
  reply(text: string): Promise<void>;
  replyWithKeyboard(text: string, keyboard: InlineKeyboardButton[][]): Promise<void>;
  typing(): Promise<void>;
}

export interface TgHandler {
  match(update: TelegramUpdate, ctx: TgContext): boolean;
  handle(ctx: TgContext): Promise<void>;
}

export interface BotConfig {
  secretEnvKey: string;
  tokenEnvKey: string;
  handlers: TgHandler[];
}
