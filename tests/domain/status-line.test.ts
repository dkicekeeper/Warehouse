import { describe, expect, it } from 'vitest';
import { parseStatusLine } from '@/lib/domain/status-line';

describe('parseStatusLine', () => {
  it.each([
    ['Готово.\n\nСтатус: ждёт владельца — смержить PR #3', 'needs_owner', 'смержить PR #3'],
    ['**Статус: работаю — жду CI**\n\n', 'working', 'жду CI'],
    ['`Статус: готово - PR #3 смержен`', 'done', 'PR #3 смержен'],
    ['✅ Status: needs-owner – unlock the phone', 'needs_owner', 'unlock the phone'],
    ['> статус: РАБОТАЮ — слежу за PR #3   ', 'working', 'слежу за PR #3'],
    ['Статус: ждет владельца — без буквы ё', 'needs_owner', 'без буквы ё'],
    ['Status: needs owner — two words', 'needs_owner', 'two words'],
    ['Status: done — shipped', 'done', 'shipped'],
    ['Status: working — waiting for CI', 'working', 'waiting for CI'],
  ])('parses %j', (msg, state, text) => {
    expect(parseStatusLine(msg)).toEqual({ state, text });
  });

  it('keeps dashes that belong to the text', () => {
    expect(parseStatusLine('Статус: готово — PR #3 смержен — сборка 78 в TestFlight')).toEqual({
      state: 'done',
      text: 'PR #3 смержен — сборка 78 в TestFlight',
    });
  });

  it('accepts a status with no text after it', () => {
    expect(parseStatusLine('Статус: готово')).toEqual({ state: 'done', text: '' });
  });

  it('requires the status line to be the last non-empty line', () => {
    expect(parseStatusLine('Статус: готово — x\nещё текст').state).toBe('unknown');
  });

  it('keeps at most 300 chars of the tail when unknown', () => {
    const r = parseStatusLine('а'.repeat(1000));
    expect(r.state).toBe('unknown');
    expect(r.text.length).toBeLessThanOrEqual(300);
  });

  it('collapses whitespace in the unknown tail and keeps its end', () => {
    const r = parseStatusLine('начало\n\n  середина   текста\nконец сообщения');
    expect(r).toEqual({ state: 'unknown', text: 'начало середина текста конец сообщения' });
  });

  it('never throws on empty input', () => {
    expect(parseStatusLine('')).toEqual({ state: 'unknown', text: '' });
    expect(parseStatusLine('   \n\n ')).toEqual({ state: 'unknown', text: '' });
  });

  it('treats an unrecognised state word as unknown', () => {
    expect(parseStatusLine('Статус: думаю — хм').state).toBe('unknown');
  });

  it('does not mistake prose mentioning the word for a status line', () => {
    expect(parseStatusLine('Проверил статус: работаю над этим дальше').state).toBe('unknown');
  });
});
