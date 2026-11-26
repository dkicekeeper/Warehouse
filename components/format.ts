/** "1 ч 10 мин", "13 дн": how long ago, or how long something has been going. */
export function duration(minutes: number): string {
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
  }
  return `${Math.floor(minutes / 1440)} дн`;
}

/** Every estimate carries a tilde; the unknown is said out loud, never guessed. */
export function approx(minutes: number | null): string {
  if (minutes === null) return '~?';
  if (minutes < 1) return '~сейчас';
  return `~${duration(minutes)}`;
}

export function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const form = mod10 === 1 && mod100 !== 11 ? forms[0] : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? forms[1] : forms[2];
  return `${n} ${form}`;
}

export function secondsAgo(generatedAt: string, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(generatedAt).getTime()) / 1000));
  if (s < 10) return 'обновлено только что';
  if (s < 60) return `обновлено ${s} с назад`;
  return `обновлено ${Math.floor(s / 60)} мин назад`;
}

const pick = (map: Record<string, string>, key: string | null, none: string) => (key === null ? none : (map[key] ?? key));

/** How a task is named on the pages: what waits for the owner is said first, whatever its status. */
export function taskLabel(task: { status: string | null; needsOwner: string | null }): string {
  if (task.needsOwner) return 'ждёт вас';
  return pick({ 'in-progress': 'в работе', ready: 'готова', blocked: 'заблокирована', idea: 'идея' }, task.status, 'без статуса');
}

export const stageLabel = (stage: string | null) =>
  pick({ idea: 'идея', development: 'разработка', beta: 'бета', live: 'выпущен', maintenance: 'поддержка' }, stage, '');

export const planLabel = (status: string | null) =>
  pick({ draft: 'черновик', approved: 'одобрен', 'in-progress': 'в работе' }, status, 'без статуса');

export const typeLabel = (type: string | null) =>
  pick({ feature: 'возможность', bug: 'ошибка', chore: 'рутина', research: 'исследование', content: 'контент', growth: 'рост' }, type, '');
