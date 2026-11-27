---
status: in-progress
kind: plan
created: 2026-11-27
updated: 2026-11-27
approved: 2026-11-27
tasks: [2026-11-26-guidelines]
---
# Гайдлайны: план работ

Дизайн: [2026-11-26-guidelines-design.md](2026-11-26-guidelines-design.md) (одобрен владельцем
2026-11-27). Исполнение — в этой сессии, задача за задачей; в конце независимое ревью ветки.

**Цель:** общие правила всех проектов в `standard/guides/`, раздел «Гайдлайны» на сайте, блок
в CLAUDE.md проектов собирается из гайдлайнов, первый аудит шести репозиториев.

**Устройство:** гайдлайны — Markdown с правилами в одном формате. Python-скрипт без зависимостей
собирает из них `standard/agents.md` (его пишет в проекты `sync_block.py`, как сейчас). Сайт
читает те же файлы в обработчике `/api/guides` после проверки cookie и разбирает их чистой
функцией `lib/domain/guides.ts`.

## Общие ограничения

- Python в `standard/` — без зависимостей, запуск `python3 -I`.
- Данные сайта — только через `/api/*` после проверки cookie; страницы — статичный каркас.
- Интерфейс — компоненты shadcn (CLI), каркас `components/shell.tsx`, цвета токенами.
- Тексты — на русском, без истории; правило не перенумеровывают.
- `standard/VERSION` остаётся 1; блок не длиннее 200 строк.

## Что проверить отдельно

1. Файлы `standard/guides/` есть в развёрнутой функции Vercel (`outputFileTracingIncludes`):
   иначе раздел пуст у владельца. Проверить по файлам развёртывания после выкладки.
2. Правило без поля «Проверка» или с неизвестным номером — разбор не падает, правило
   показывается с меткой «проверка не указана»; тест.
3. Ссылка «Предложить правку» с кириллицей и переводами строк — кодируется, открывает
   редактор GitHub с нужным именем файла; тест.
4. `agents.md` устарел относительно гайдлайнов — тест падает с понятным сообщением.
5. Номер правила в блоке, которого нет в гайдлайнах (опечатка), — тест падает.

---

### Задача 1. Формат правил и разбор

**Файлы:** `standard/guides/README.md`, `lib/domain/guides.ts`, `tests/domain/guides.test.ts`.

**Интерфейс (TS):**
```ts
export type CheckKind = 'auto' | 'audit';
export interface GuideRule { id: string; title: string; text: string; why: string | null;
  checks: { kind: CheckKind; label: string }[]; where: string | null; agent: boolean }
export interface Guide { slug: string; title: string; intro: string; body: string;
  rules: GuideRule[]; agentPart: string }
export function parseGuide(slug: string, markdown: string): Guide
export function proposeUrl(rule: GuideRule | null, guide: Guide, today: string): string
```
Правило — заголовок `### <PREFIX>-<n>. <Название>`, за ним абзацы, начинающиеся с `Правило:`,
`Почему:`, `Проверка:` (части через `|`; `аудит` → `audit`, остальное → `auto`), `Где:`,
`Агенту: да|нет`. Раздел `## Коротко для агента` — `agentPart`. Ссылка:
`https://github.com/dkicekeeper/Warehouse/new/main?filename=docs/backlog/<today>-guide-<id>.md&value=<шаблон idea>`.

- [ ] Тесты: разбор правила со всеми полями; правило без «Проверки» (checks пусты);
  кодирование ссылки (кириллица, `\n`); `agentPart` без заголовка.
- [ ] Реализация, тесты зелёные, коммит.

### Задача 2. Тексты гайдлайнов

**Файлы:** `standard/guides/{projects,docs,sessions,ci,security,release,design,audit}.md`,
`docs/decisions/2026-11-26-sessions-merge-own-prs.md`.

Источники: `standard/agents.md`, CLAUDE.md шести репозиториев, `docs/decisions/` всех
репозиториев, `hooks/README.md`, `docs/setup.md`, `docs/agents.md` и CLAUDE.md DesignKit.
Правило записывается, только если оно записано в репозитории или решено владельцем; иначе —
предложение в отчёте аудита. В начале — «Как это устроено», в конце — «Коротко для агента».
`docs.md` переносит текущий `agents.md` дословно в «Коротко для агента».

- [ ] Тест `tests/standard/guides.test.ts`: каждый файл разбирается, номера уникальны и
  начинаются с префикса файла, у каждого правила есть «Правило» и «Проверка».
- [ ] Тексты, решение о мерже, тест зелёный, коммит.

### Задача 3. Блок для агентов из гайдлайнов

**Файлы:** `standard/build_agents.py`, `standard/agents.md` (теперь генерируется),
`standard/sync_block.py` (текст пометки), `tests/standard/agents-block.test.ts`,
`tests/standard/sync-block.test.ts` (предел 150 → 200).

`python3 -I standard/build_agents.py [--check]` пишет `agents.md`: заголовок, затем разделы
«Коротко для агента» гайдлайнов в порядке оглавления README, ссылка на полный текст на GitHub.
Код выхода 1 с `--check`, если файл устарел.

- [ ] Тесты: `--check` зелёный на репозитории; номера в блоке ⊂ номера гайдлайнов; каждое
  правило с «Агенту: да» упомянуто в блоке; ≤ 200 строк; номера, которые находит Python, те же,
  что находит `parseGuide`.
- [ ] Реализация, сгенерированный `agents.md`, тесты зелёные, коммит.

### Задача 4. Раздел «Гайдлайны» на сайте

**Файлы:** `lib/api/guides.ts` (`handleGuides(deps)`), `app/api/guides/route.ts`,
`app/(app)/guides/page.tsx`, `app/(app)/guides/[slug]/page.tsx`, `components/guides.tsx`,
`components/shell.tsx` (пункт меню), `next.config.ts` (`outputFileTracingIncludes`),
`tests/api/guides.test.ts`, `tests/e2e/guides.e2e.ts`; `react-markdown` + `remark-gfm`.

- [ ] Тест обработчика: 401 без владельца; список гайдлайнов в порядке README с числом правил
  и автоматических проверок.
- [ ] Страницы: оглавление; гайдлайн с правилами, метками проверки, «Предложить правку».
- [ ] Браузерный тест: телефон и компьютер, без горизонтальной прокрутки, ссылка правки.
- [ ] Все проверки зелёные, коммит.

### Задача 5. Первый аудит

Пройти шесть репозиториев по `audit.md`: `lint.py`, правила «на аудите». Расхождения — задачи
в `docs/backlog/` проектов (PR с одними документами, по одному на репозиторий, мерж после
зелёного CI); предложения поменять правила — задачи в Warehouse. Итог — `docs/archive/audit-2026-11-27.md` (сводка:
проверено, найдено, ссылки) и сообщение сессии.

### Задача 6. Документы и выкладка

CLAUDE.md, `docs/project.md`, `docs/roadmap.md`, `docs/README.md`; задача и план — в архив; PR,
мерж, проверка развёртывания (пункт 1 «Что проверить отдельно»), независимое ревью ветки.
