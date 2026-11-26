import { beforeEach, describe, expect, it } from 'vitest';
import { handleTelegramWebhook } from '@/lib/api/telegram-webhook';
import type { PgStore } from '@/lib/store/pg';
import { testStore } from '../helpers/db';
import { NOW, minutesAgo, minutesFromNow } from '../helpers/factories';

const SECRET = 'tg_hook_secret';
let store: PgStore;
let replies: { chatId: string; text: string }[];
beforeEach(async () => {
  ({ store } = await testStore());
  replies = [];
  await store.patchSettings({ telegramLinkCode: { code: 'K7Q2XW', expiresAt: minutesFromNow(10) } });
});

const update = (text: string, chat: Record<string, unknown> = { id: 4242, type: 'private' }) => ({
  update_id: 1,
  message: { message_id: 1, chat, text },
});

const post = (body: unknown, secret: string | null = SECRET) =>
  new Request('https://w.example/api/telegram/webhook', {
    method: 'POST',
    headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const handle = (req: Request, over = {}) =>
  handleTelegramWebhook(req, {
    store,
    now: NOW,
    secret: SECRET,
    reply: async (chatId: string, text: string) => {
      replies.push({ chatId, text });
    },
    ...over,
  });

describe('Telegram webhook', () => {
  it('/start with the right code binds the chat, burns the code and confirms', async () => {
    const res = await handle(post(update('/start K7Q2XW')));
    expect(res.status).toBe(200);
    expect(await store.getSettings()).toMatchObject({ telegramChatId: '4242', telegramLinkCode: null });
    expect(replies).toEqual([{ chatId: '4242', text: 'Готово, уведомления Warehouse будут приходить сюда.' }]);
  });

  it.each([
    ['a wrong code', '/start NOPE00'],
    ['no code', '/start'],
    ['an ordinary message', 'привет'],
    ['the code without the command', 'K7Q2XW'],
  ])('%s binds nothing and gets no answer', async (_n, text) => {
    const res = await handle(post(update(text)));
    expect(res.status).toBe(200);
    expect((await store.getSettings()).telegramChatId).toBeNull();
    expect(replies).toEqual([]);
  });

  it('an expired code binds nothing', async () => {
    await store.patchSettings({ telegramLinkCode: { code: 'K7Q2XW', expiresAt: minutesAgo(1) } });
    await handle(post(update('/start K7Q2XW')));
    expect((await store.getSettings()).telegramChatId).toBeNull();
  });

  it('a group chat cannot be bound, even with the code', async () => {
    await handle(post(update('/start K7Q2XW', { id: -100555, type: 'supergroup' })));
    expect((await store.getSettings()).telegramChatId).toBeNull();
  });

  it('the code works once', async () => {
    await handle(post(update('/start K7Q2XW')));
    await handle(post(update('/start K7Q2XW', { id: 999, type: 'private' })));
    expect((await store.getSettings()).telegramChatId).toBe('4242');
  });

  it('a wrong or missing secret header → empty 401, nothing bound', async () => {
    for (const s of ['wrong', null]) {
      const res = await handle(post(update('/start K7Q2XW'), s));
      expect(res.status).toBe(401);
      expect(await res.text()).toBe('');
    }
    expect((await store.getSettings()).telegramChatId).toBeNull();
  });

  it('rejects everything when no secret is configured', async () => {
    expect((await handle(post(update('/start K7Q2XW'), ''), { secret: '' })).status).toBe(401);
  });

  it('answers 200 to updates it does not understand, so Telegram does not retry them', async () => {
    expect((await handle(post('not json'))).status).toBe(200);
    expect((await handle(post({ update_id: 2, edited_message: {} }))).status).toBe(200);
    expect((await handle(post({ update_id: 3, message: { chat: { id: 1, type: 'private' } } }))).status).toBe(200);
  });

  it('a failing confirmation message does not undo the binding', async () => {
    const res = await handle(post(update('/start K7Q2XW')), {
      reply: async () => {
        throw new Error('Telegram 429');
      },
    });
    expect(res.status).toBe(200);
    expect((await store.getSettings()).telegramChatId).toBe('4242');
  });
});
