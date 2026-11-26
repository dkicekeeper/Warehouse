import { describe, expect, it } from 'vitest';
import { approx, duration, plural, secondsAgo } from '@/components/format';

describe('duration', () => {
  it.each([
    [0, 'только что'],
    [1, '1 мин'],
    [59, '59 мин'],
    [60, '1 ч'],
    [70, '1 ч 10 мин'],
    [120, '2 ч'],
    [1439, '23 ч 59 мин'],
    [1440, '1 дн'],
    [13 * 1440 + 300, '13 дн'],
  ])('%i min → %s', (min, text) => {
    expect(duration(min)).toBe(text);
  });
});

describe('approx', () => {
  it('marks estimates with a tilde and the unknown with a question mark', () => {
    expect(approx(40)).toBe('~40 мин');
    expect(approx(75)).toBe('~1 ч 15 мин');
    expect(approx(0)).toBe('~сейчас');
    expect(approx(null)).toBe('~?');
  });
});

describe('plural', () => {
  it('declines Russian nouns by number', () => {
    const f = (n: number) => plural(n, ['сессия', 'сессии', 'сессий']);
    expect([1, 2, 5, 11, 21, 22, 25, 111, 0].map(f)).toEqual([
      '1 сессия', '2 сессии', '5 сессий', '11 сессий', '21 сессия', '22 сессии', '25 сессий', '111 сессий', '0 сессий',
    ]);
  });
});

describe('secondsAgo', () => {
  it('describes how fresh the data is', () => {
    const t = new Date('2026-11-25T07:00:00Z');
    expect(secondsAgo(t.toISOString(), new Date(t.getTime() + 4000))).toBe('обновлено только что');
    expect(secondsAgo(t.toISOString(), new Date(t.getTime() + 12_000))).toBe('обновлено 12 с назад');
    expect(secondsAgo(t.toISOString(), new Date(t.getTime() + 185_000))).toBe('обновлено 3 мин назад');
  });
});

describe('backlog labels', () => {
  it('names a task by what the owner cares about', async () => {
    const { taskLabel } = await import('@/components/format');
    expect(taskLabel({ status: 'blocked', needsOwner: 'ключ' })).toBe('ждёт вас');
    expect(taskLabel({ status: 'ready', needsOwner: 'вопрос' })).toBe('ждёт вас');
    expect(taskLabel({ status: 'blocked', needsOwner: null })).toBe('заблокирована');
    expect(taskLabel({ status: 'in-progress', needsOwner: null })).toBe('в работе');
    expect(taskLabel({ status: 'ready', needsOwner: null })).toBe('готова');
    expect(taskLabel({ status: 'idea', needsOwner: null })).toBe('идея');
    expect(taskLabel({ status: null, needsOwner: null })).toBe('без статуса');
    expect(taskLabel({ status: 'weird', needsOwner: null })).toBe('weird');
  });

  it('names stages, plan states and task types in Russian, and leaves the unknown as it is', async () => {
    const { stageLabel, planLabel, typeLabel } = await import('@/components/format');
    expect(['idea', 'development', 'beta', 'live', 'maintenance', null, 'x'].map(stageLabel)).toEqual(['идея', 'разработка', 'бета', 'выпущен', 'поддержка', '', 'x']);
    expect(['draft', 'approved', 'in-progress', null].map(planLabel)).toEqual(['черновик', 'одобрен', 'в работе', 'без статуса']);
    expect(['feature', 'bug', 'chore', 'research', 'content', 'growth', null].map(typeLabel)).toEqual(['возможность', 'ошибка', 'рутина', 'исследование', 'контент', 'рост', '']);
  });
});
