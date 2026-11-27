import { describe, expect, it } from 'vitest';
import { parseGuide, proposeUrl } from '@/lib/domain/guides';

const SAMPLE = `# Документы

Как это устроено: в \`docs/\` только актуальное.

## Дерево

### DOC-1. Новых папок не заводят

Правило: в \`docs/\` только папки стандарта; путь инструмента — в \`docs/.standard.json\`.

Почему: решение владельца [2026-11-26-standard-full-unification](https://example.com/d.md).

Проверка: lint.py \`tree\` | аудит

Где: все

Агенту: да

### DOC-2. Без истории

Правило: в актуальных документах нет «раньше было так».

Где: все

## Коротко для агента

- Новых папок в \`docs/\` не заводят (DOC-1).
`;

describe('parseGuide', () => {
  const g = parseGuide('docs', SAMPLE);

  it('reads the title, the intro and the agent part', () => {
    expect(g.slug).toBe('docs');
    expect(g.title).toBe('Документы');
    expect(g.intro).toBe('Как это устроено: в `docs/` только актуальное.');
    expect(g.agentPart).toBe('- Новых папок в `docs/` не заводят (DOC-1).');
  });

  it('reads a rule with all its fields', () => {
    expect(g.rules[0]).toEqual({
      id: 'DOC-1',
      title: 'Новых папок не заводят',
      text: 'в `docs/` только папки стандарта; путь инструмента — в `docs/.standard.json`.',
      why: 'решение владельца [2026-11-26-standard-full-unification](https://example.com/d.md).',
      checks: [
        { kind: 'auto', label: 'lint.py `tree`' },
        { kind: 'audit', label: 'аудит' },
      ],
      where: 'все',
      agent: true,
    });
  });

  it('a rule without a check or a reason still parses, with nothing in those fields', () => {
    expect(g.rules[1]).toMatchObject({ id: 'DOC-2', why: null, checks: [], agent: false });
  });

  it('keeps the body without the title and the agent part, for the page', () => {
    expect(g.body).toContain('### DOC-1. Новых папок не заводят');
    expect(g.body).not.toContain('Коротко для агента');
    expect(g.body.startsWith('# ')).toBe(false);
  });
});

describe('proposeUrl', () => {
  const g = parseGuide('docs', SAMPLE);

  it('opens the GitHub editor for a new task about the rule, with Cyrillic and new lines encoded', () => {
    const url = new URL(proposeUrl(g.rules[0]!, g, '2026-11-27'));
    expect(url.origin + url.pathname).toBe('https://github.com/dkicekeeper/Warehouse/new/main');
    expect(url.searchParams.get('filename')).toBe('docs/backlog/2026-11-27-guide-doc-1.md');
    const value = url.searchParams.get('value')!;
    expect(value.startsWith('---\nstatus: idea\n')).toBe(true);
    expect(value).toContain('# Правило DOC-1 «Новых папок не заводят»: предлагаю');
    expect(value).toContain('created: 2026-11-27');
  });

  it('without a rule proposes a change to the guide as a whole', () => {
    const url = new URL(proposeUrl(null, g, '2026-11-27'));
    expect(url.searchParams.get('filename')).toBe('docs/backlog/2026-11-27-guide-docs.md');
    expect(url.searchParams.get('value')).toContain('# Гайдлайн «Документы»: предлагаю');
  });
});
