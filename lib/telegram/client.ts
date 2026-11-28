import type { Notifier } from '@/lib/recompute';

const API = 'https://api.telegram.org';

/** The message to edit no longer exists (the owner deleted it): there is nothing left to edit. */
export class MessageGone extends Error {
  constructor() {
    super('Telegram: сообщения больше нет');
  }
}

interface TgResponse {
  ok?: boolean;
  description?: string;
  result?: { message_id?: number };
}

/** A Telegram bot that speaks to one chat at a time. HTML mode, link previews off. */
export function telegramNotifier(token: string, fetchImpl: typeof fetch = fetch): Notifier & {
  send(chatId: string, html: string): Promise<{ messageId: number }>;
} {
  async function call(method: string, body: Record<string, unknown>): Promise<TgResponse> {
    let res: Response;
    try {
      res = await fetchImpl(`${API}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // The underlying error can quote the URL, and the URL carries the bot token.
      throw new Error('Telegram: сеть недоступна');
    }
    let data: TgResponse = {};
    try {
      data = (await res.json()) as TgResponse;
    } catch {
      /* not JSON */
    }
    if (!res.ok || data.ok !== true) {
      throw new Error(`Telegram ${res.status}${data.description ? `: ${data.description}` : ''}`);
    }
    return data;
  }

  return {
    async send(chatId, html) {
      const data = await call('sendMessage', {
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
      return { messageId: Number(data.result?.message_id) };
    },
    async edit(chatId, messageId, html) {
      try {
        await call('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: html,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        });
      } catch (err) {
        if (err instanceof Error && /message is not modified/i.test(err.message)) return;
        if (err instanceof Error && /message to edit not found/i.test(err.message)) throw new MessageGone();
        throw err;
      }
    },
  };
}
