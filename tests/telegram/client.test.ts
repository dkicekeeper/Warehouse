import { describe, expect, it } from 'vitest';
import { telegramNotifier } from '@/lib/telegram/client';

function fake(responses: (() => Response)[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const impl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return (responses.shift() ?? (() => new Response('{}', { status: 500 })))();
  };
  return { calls, impl };
}
const json = (data: unknown, status = 200) => () => new Response(JSON.stringify(data), { status });

describe('telegramNotifier', () => {
  it('sends HTML without a link preview and returns the message id', async () => {
    const f = fake([json({ ok: true, result: { message_id: 321 } })]);
    const out = await telegramNotifier('123:ABC', f.impl).send('42', '<b>Tenra</b> · смержить');
    expect(out).toEqual({ messageId: 321 });
    expect(f.calls).toEqual([
      {
        url: 'https://api.telegram.org/bot123:ABC/sendMessage',
        body: { chat_id: '42', text: '<b>Tenra</b> · смержить', parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
      },
    ]);
  });

  it('edits a message in place', async () => {
    const f = fake([json({ ok: true, result: {} })]);
    await telegramNotifier('123:ABC', f.impl).edit('42', 321, 'новый текст');
    expect(f.calls[0]).toMatchObject({
      url: 'https://api.telegram.org/bot123:ABC/editMessageText',
      body: { chat_id: '42', message_id: 321, text: 'новый текст', parse_mode: 'HTML' },
    });
  });

  it('treats «message is not modified» as a successful edit', async () => {
    const f = fake([json({ ok: false, error_code: 400, description: 'Bad Request: message is not modified' }, 400)]);
    await expect(telegramNotifier('t', f.impl).edit('42', 1, 'x')).resolves.toBeUndefined();
  });

  it('throws with Telegram’s own description on 429 and 403', async () => {
    const f = fake([
      json({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } }, 429),
      json({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 403),
    ]);
    const n = telegramNotifier('t', f.impl);
    await expect(n.send('42', 'x')).rejects.toThrow('Telegram 429: Too Many Requests: retry after 7');
    await expect(n.send('42', 'x')).rejects.toThrow('Telegram 403: Forbidden: bot was blocked by the user');
  });

  it('throws when the answer says ok:false with a 200, or is not JSON at all', async () => {
    const f = fake([json({ ok: false, description: 'weird' }), () => new Response('<html>502</html>', { status: 502 })]);
    const n = telegramNotifier('t', f.impl);
    await expect(n.send('42', 'x')).rejects.toThrow(/weird/);
    await expect(n.send('42', 'x')).rejects.toThrow('Telegram 502');
  });

  it('never puts the bot token into an error message', async () => {
    const impl: typeof fetch = async () => {
      throw new Error('connect ETIMEDOUT https://api.telegram.org/bot123:SECRET/sendMessage');
    };
    await expect(telegramNotifier('123:SECRET', impl).send('42', 'x')).rejects.toThrow(/^(?!.*SECRET).*$/);
  });
});
