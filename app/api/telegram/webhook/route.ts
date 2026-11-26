import { handleTelegramWebhook } from '@/lib/api/telegram-webhook';
import { getStore } from '@/lib/store/db';
import { telegramNotifier } from '@/lib/telegram/client';

export async function POST(req: Request): Promise<Response> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  return handleTelegramWebhook(req, {
    store: getStore(),
    now: new Date(),
    secret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
    reply: async (chatId, text) => {
      if (token) await telegramNotifier(token).send(chatId, text);
    },
  });
}
