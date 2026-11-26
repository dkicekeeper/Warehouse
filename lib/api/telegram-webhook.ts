import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '@/lib/store/store';

export interface TelegramWebhookDeps {
  store: Store;
  now: Date;
  secret: string;
  reply: (chatId: string, text: string) => Promise<unknown>;
}

const Update = z.object({
  message: z.object({
    chat: z.object({ id: z.number(), type: z.string() }),
    text: z.string(),
  }),
});

const same = (a: string, b: string) => {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * The bot listens for one thing: `/start <code>` from a private chat, with the one-time code the
 * settings page shows. That binds the owner's chat. Everything else is ignored in silence, and
 * always with a 200, so Telegram does not keep redelivering it.
 */
export async function handleTelegramWebhook(req: Request, deps: TelegramWebhookDeps): Promise<Response> {
  const given = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!deps.secret || !same(given, deps.secret)) return new Response(null, { status: 401 });

  const ok = new Response(null, { status: 200 });
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return ok;
  }
  const update = Update.safeParse(json);
  if (!update.success || update.data.message.chat.type !== 'private') return ok;

  const m = /^\/start\s+(\S+)\s*$/.exec(update.data.message.text);
  if (!m?.[1]) return ok;

  const link = (await deps.store.getSettings()).telegramLinkCode;
  if (!link || link.expiresAt.getTime() <= deps.now.getTime() || !same(m[1], link.code)) return ok;

  const chatId = String(update.data.message.chat.id);
  await deps.store.patchSettings({ telegramChatId: chatId, telegramLinkCode: null });
  await deps.reply(chatId, 'Готово, уведомления Warehouse будут приходить сюда.').catch(() => {});
  return ok;
}
