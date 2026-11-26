---
status: done
kind: plan
created: 2026-11-26
updated: 2026-11-26
approved: 2026-11-26
tasks: [2026-11-26-standard-rollout]
---
# Стандарт ведения проекта: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Каталог `standard/` в Warehouse (правила, проверка, синхронизация блока, шаблон) и переезд шести репозиториев на одно дерево `docs/` с полями статуса.

**Architecture:** Стандарт — данные и два скрипта Python без зависимостей в `standard/`; проекты забирают их из `main` Warehouse в своём workflow `standard.yml` на `ubuntu-latest`. Проверка (`lint.py`) одним разбором и проверяет дерево, и отдаёт его как JSON. Переезд каждого репозитория — отдельный PR по одной процедуре.

**Tech Stack:** Python 3 (только стандартная библиотека), тесты Vitest, которые запускают скрипты так же, как `tests/hooks/report.test.ts`; GitHub Actions.

**Spec:** [2026-11-26-project-standard-design.md](2026-11-26-project-standard-design.md)

## Global Constraints

- Никаких секретов и личных данных в репозиториях; репозитории публичные (кроме Baja.kz).
- Все задания Actions на `ubuntu-latest`; ни одного на macOS.
- Скрипты `standard/*.py`: Python 3, без сторонних пакетов, запускаются с `-I`.
- Папки `docs/` ровно: `backlog`, `plans`, `decisions`, `domains`, `public`, `archive` (+ исключения из `docs/.standard.json`).
- Имена файлов: строчные латинские буквы, цифры, дефис; исключения `README.md`, коды локалей.
- Ключи шапки и значения-перечисления — английские, ровно как в спецификации (раздел «Форматы»).
- Метки блока: `<!-- warehouse:standard:start -->` и `<!-- warehouse:standard:end -->`.
- Блок правил на русском во всех репозиториях; документы остаются на своём языке; разделы задач в Tenra и DesignKit: `Why`, `Done when`, `Notes`.
- Сначала падающий тест, потом код. Тексты для владельца — на русском, идентификаторы — на английском.
- Переезд: `git mv`, один PR на репозиторий, мерж владельца; архив без шапок не трогается.
- Пути из раздела спецификации «Пути, которые нельзя трогать» не переименовываются.

## Review Focus

1. Шапка с BOM или переводами строк CRLF (файл создан на другой системе): разбирается так же, как обычная. Тест в задаче 1.
2. Опечатка в ключе или значении (`staus: ready`, `status: redy`): нарушение называет ключ и допустимые значения, а не падает трассировкой. Тест в задаче 3.
3. Ссылки markdown с якорем (`a.md#раздел`), в угловых скобках, с пробелом через `%20`, и «ссылки» внутри блоков кода: первые три проверяются по файлу без якоря, в блоках кода не проверяются. Тест в задаче 4.
4. `CLAUDE.md` с одной меткой из двух или с двумя блоками: `sync_block.py` ничего не пишет и выходит с кодом 2 и объяснением, а не портит файл. Тест в задаче 5.
5. Нечитаемый как UTF-8 или двоичный файл внутри `docs/` (картинка, `.json`, `.html` сайта): проверка читает только `.md`, остальное оценивает лишь по имени и месту. Тест в задаче 2.

---

## Файлы

```
standard/
├── VERSION            «1»
├── lint.py            разбор и проверка дерева; --json
├── sync_block.py      блок agents.md → CLAUDE.md
├── agents.md          текст блока
├── workflow.yml       образец .github/workflows/standard.yml
└── template/docs/     README.md, project.md, .standard.json, backlog/<пример>.md,
                       plans/.gitkeep, decisions/.gitkeep, domains/.gitkeep, archive/.gitkeep
tests/standard/
├── tree.ts            помощник: строит дерево во временной папке, запускает скрипты
├── lint-parse.test.ts
├── lint-structure.test.ts
├── lint-records.test.ts
├── lint-links.test.ts
├── sync-block.test.ts
└── template.test.ts
```

Общий интерфейс `lint.py` (задачи 1–4 наращивают один файл):

- Запуск: `python3 -I standard/lint.py [--root DIR] [--json]`; `DIR` — корень репозитория, по умолчанию текущая папка.
- Нарушение — строка в stdout: `<путь от корня>: [<код>] <что не так>. <как исправить>`. Коды: `tree`, `passport`, `header`, `place`, `dor`, `ref`, `link`, `name`, `index`.
- Код выхода: 0 чисто, 1 есть нарушения, 2 ошибка запуска (нет `docs/`).
- `--json` печатает один объект и те же коды выхода:

```json
{"standard": 1,
 "project": {"name": "", "stage": "", "kind": "", "platforms": [], "standard": 1, "links": {}, "title": ""},
 "backlog": [{"id": "", "path": "", "archived": false, "title": "", "status": "", "type": "", "priority": 2,
              "size": "", "created": "", "updated": "", "needs-owner": null, "plan": null, "branch": null, "pr": null}],
 "plans": [{"id": "", "path": "", "archived": false, "title": "", "status": "", "kind": "", "created": "",
            "updated": "", "approved": null, "tasks": []}],
 "decisions": [{"id": "", "path": "", "archived": false, "title": "", "status": "", "decided": "", "by": "",
                "supersedes": null}],
 "violations": [{"path": "", "code": "", "message": ""}]}
```

- `docs/.standard.json` репозитория: `{"ignore": [{"path": "docs/components.json", "reason": "…"}]}`; `path` — файл или папка (со всем содержимым), проверка их не видит вовсе.

Помощник тестов `tests/standard/tree.ts`:

```ts
export function makeTree(files: Record<string, string>): string            // временная папка, возвращает путь
export function runLint(root: string, args?: string[]): { code: number; out: string }
export function runSync(claudeMd: string, args?: string[]): { code: number; out: string }
export const VALID: Record<string, string>   // минимальное правильное дерево: README, project.md, по одной задаче, плану, решению
```

---

### Task 1: Разбор шапки и `--json`

**Files:**
- Create: `standard/lint.py`, `standard/VERSION`, `tests/standard/tree.ts`
- Test: `tests/standard/lint-parse.test.ts`

**Interfaces:**
- Produces: в `lint.py` — `parse_header(text: str) -> tuple[dict | None, str, list[str]]` (поля, тело, ошибки разбора); `load_tree(root: str) -> dict` (объект формы `--json` без `violations`); `main(argv) -> int`. Подмножество YAML: `ключ: значение`; строки в одинарных и двойных кавычках; целые числа; `true`/`false`; списки `[a, b]`; один уровень вложенности отступом в два пробела (для `links`); комментарий после ` #` вне кавычек; пустые строки.

- [ ] **Step 1: Падающие тесты** в `lint-parse.test.ts`:
  - `VALID` → код 0, `--json` отдаёт `project.name`, одну задачу с `id` = имени файла без `.md`, `title` = текст первого заголовка `# `, `archived: false`, отсутствующие ключи как `null`;
  - задача в `docs/archive/backlog/` → `archived: true`;
  - шапка с BOM и CRLF разбирается так же;
  - `needs-owner: "выбрать цену"  # комментарий` → значение `выбрать цену`;
  - `tasks: [a, b]` → `["a","b"]`; `tasks: []` → `[]`;
  - вложенный `links:` с `store:` и `testflight: true`;
  - незакрытая шапка (нет второго `---`) → нарушение `[header]`, код 1;
  - нет папки `docs/` → код 2.
- [ ] **Step 2:** `pnpm vitest run tests/standard/lint-parse.test.ts` — падают («нет файла lint.py»).
- [ ] **Step 3:** Реализовать разбор, `load_tree`, `--json`, `main`; `standard/VERSION` = `1`.
- [ ] **Step 4:** Тесты зелёные.
- [ ] **Step 5:** Коммит `Standard: header parser and tree reader`.

### Task 2: Проверки дерева, паспорта, имён, оглавления

**Files:**
- Modify: `standard/lint.py`
- Test: `tests/standard/lint-structure.test.ts`

**Interfaces:**
- Consumes: `load_tree`, `parse_header`.
- Produces: `check_structure(root, tree, ignore) -> list[Violation]`, где `Violation = (path, code, message)`; чтение `docs/.standard.json`.

- [ ] **Step 1: Падающие тесты**, по одному дереву на нарушение (ожидается код 1 и строка с кодом):
  - лишняя папка `docs/misc/` → `[tree]`; та же папка в `ignore` → чисто;
  - любые подпапки внутри `docs/archive/` и `docs/public/` → чисто;
  - нет `docs/README.md` или `docs/project.md` → `[tree]`;
  - в паспорте нет `stage` / `stage: launched` / `kind: game` / `standard` не число → `[passport]` с перечнем допустимых (`stage`: idea, development, beta, live, maintenance; `kind`: ios-app, web, library, service);
  - `docs/PLAN.md`, `docs/My_File.md` → `[name]`; `README.md`, `domains/pt-BR.md` → чисто; файлы в `archive/` и `public/` на имена не проверяются;
  - `docs/architecture.md` и `docs/domains/map.md`, не упомянутые в `docs/README.md` → `[index]`; упомянутые (подстрока пути от `docs/`) → чисто;
  - `docs/public/icon.png` с произвольными байтами и `docs/data.json` → не читаются, проверка не падает (`data.json` → чисто по имени);
  - `.gitkeep` в пустых папках → чисто.
- [ ] **Step 2:** Запуск — падают.
- [ ] **Step 3:** Реализовать `check_structure`, подключить к `main`.
- [ ] **Step 4:** Тесты задач 1–2 зелёные.
- [ ] **Step 5:** Коммит `Standard lint: tree, passport, names, index`.

### Task 3: Проверки задач, планов и решений

**Files:**
- Modify: `standard/lint.py`
- Test: `tests/standard/lint-records.test.ts`

**Interfaces:**
- Produces: `check_records(root, tree) -> list[Violation]`.

Допустимые значения (из спецификации): задача `status` idea|ready|in-progress|blocked|done|dropped, `type` feature|bug|chore|research|content|growth, `priority` 1|2|3, `size` s|m|l, обязательны `status`, `type`, `created`, `updated`; с `ready` обязательны ещё `priority`, `size`. План `status` draft|approved|in-progress|done|dropped, `kind` design|plan, обязательны `status`, `kind`, `created`, `updated`; `approved` обязателен со статуса `approved`. Решение `status` active|superseded, `by` owner|claude, обязательны `status`, `decided`, `by`. Даты — существующий день ISO.

- [ ] **Step 1: Падающие тесты:**
  - неизвестный ключ `staus: ready` → `[header]`, сообщение называет ключ и список допустимых ключей;
  - `status: redy` → `[header]` со списком значений; `created: 2026-13-40` → `[header]`;
  - имя `docs/backlog/attachments.md` без даты → `[name]`;
  - `status: done` в `docs/backlog/` → `[place]`; `status: ready` в `docs/archive/backlog/` → `[place]`; то же для планов (`done`, `dropped`) и решений (`superseded`);
  - `ready` без раздела «Зачем» или «Готово, когда» → `[dor]`; с `Why` и `Done when` → чисто; `idea` без разделов → чисто; нет заголовка `# ` → `[dor]`;
  - `ready` с ключом `needs-owner` → `[dor]`;
  - `blocked` без `needs-owner` и без строки, начинающейся с «Ждёт:» / `Waiting:` → `[dor]`;
  - `size: l`, `status: done` без `plan` → `[dor]`;
  - `plan: plans/nope.md` → `[ref]`; `plan` на файл в `archive/plans/` → чисто; `tasks: [nope]` → `[ref]`; `supersedes: nope` → `[ref]`;
  - план `approved` без даты `approved` → `[header]`;
  - файл без шапки в `docs/archive/plans/` → чисто; файл без шапки в `docs/backlog/` → `[header]`.
- [ ] **Step 2:** Запуск — падают.
- [ ] **Step 3:** Реализовать `check_records`. Раздел распознаётся по строке, которая начинается с названия и двоеточия, или по заголовку `## Название`. Ссылки `plan` разрешаются от `docs/`; `tasks` и `supersedes` — по `id` среди актуальных и архивных.
- [ ] **Step 4:** Тесты задач 1–3 зелёные.
- [ ] **Step 5:** Коммит `Standard lint: backlog, plans, decisions`.

### Task 4: Проверка ссылок

**Files:**
- Modify: `standard/lint.py`
- Test: `tests/standard/lint-links.test.ts`

**Interfaces:**
- Produces: `check_links(root, ignore) -> list[Violation]`. Проверяются `CLAUDE.md` и `docs/**/*.md`, кроме `docs/archive/**` и путей из `ignore`.

- [ ] **Step 1: Падающие тесты:**
  - `[x](missing.md)` → `[link]` с номером строки; `[x](domains/map.md)` на существующий → чисто;
  - `[x](a.md#раздел)` проверяет `a.md`; `[x](#раздел)` и `[x](https://…)`, `mailto:` → не проверяются;
  - `[x](<my file.md>)` и `[x](my%20file.md)` → находят `my file.md`;
  - ссылка на папку (`[x](backlog/)`) → чисто, если папка есть;
  - ссылка внутри блока ``` и внутри `строчного кода` → не проверяется;
  - битая ссылка в `docs/archive/old.md` → чисто;
  - ссылка из `CLAUDE.md` на `docs/nope.md` → `[link]`;
  - ссылка, выходящая за корень репозитория (`../other/x.md`) → не проверяется.
- [ ] **Step 2:** Запуск — падают.
- [ ] **Step 3:** Реализовать `check_links`.
- [ ] **Step 4:** `pnpm vitest run tests/standard` зелёный.
- [ ] **Step 5:** Коммит `Standard lint: relative links`.

### Task 5: Блок правил и его синхронизация

**Files:**
- Create: `standard/agents.md`, `standard/sync_block.py`
- Test: `tests/standard/sync-block.test.ts`

**Interfaces:**
- Produces: `python3 -I standard/sync_block.py <CLAUDE.md> [--check]`. Источник — `agents.md` рядом со скриптом, версия — `VERSION`. Блок: метка начала, строка `<!-- Стандарт Warehouse, версия N. Не править здесь: блок переписывает workflow standard.yml. -->`, текст с заголовками на уровень ниже, метка конца. Код выхода: 0 — файл актуален или записан; 1 — `--check` и файл устарел; 2 — метки сломаны (одна из двух, или блоков больше одного), файл не тронут.

- [ ] **Step 1: Падающие тесты:**
  - файл без меток → блок дописан в конец, остальное байт в байт то же;
  - файл с блоком старой версии → заменён только блок;
  - повторный запуск ничего не меняет (тот же текст, код 0);
  - `--check` на устаревшем → код 1, файл не изменён; на актуальном → 0;
  - только начальная метка, или два блока → код 2, файл не изменён, сообщение называет причину;
  - `# Заголовок` в `agents.md` становится `## Заголовок` в блоке.
- [ ] **Step 2:** Запуск — падают.
- [ ] **Step 3:** Реализовать `sync_block.py`.
- [ ] **Step 4:** Написать `standard/agents.md` по разделам спецификации «Дерево» (с правилами дерева), «Форматы» (четыре шапки с допустимыми значениями и жизнью задачи), «Определения» (DoR и DoD по пунктам дословно), «Чеклисты» (четыре), и раздел «Строка состояния для Warehouse» — дословно текст из `hooks/claude-md-snippet.md`. В начале блока: где искать проверку (`python3 -I <Warehouse>/standard/lint.py`), что разделы задач в английских репозиториях называются `Why` / `Done when` / `Notes`. Не длиннее 150 строк.
- [ ] **Step 5:** Тесты зелёные; коммит `Standard: the rules block and its sync`.

### Task 6: Шаблон нового проекта и образец workflow

**Files:**
- Create: `standard/template/docs/**`, `standard/workflow.yml`
- Test: `tests/standard/template.test.ts`

**Interfaces:**
- Consumes: `runLint`.
- Produces: `standard/workflow.yml` — файл, который проекты копируют как `.github/workflows/standard.yml` без правок.

- [ ] **Step 1: Падающий тест:** копия `standard/template/` во временную папку плюс `CLAUDE.md` из одной строки проходит `lint.py` с кодом 0; `--json` отдаёт одну задачу-пример со статусом `idea`.
- [ ] **Step 2:** Запуск — падает.
- [ ] **Step 3:** Создать шаблон: `docs/README.md` (оглавление с правилами в три строки и ссылкой на блок в `CLAUDE.md`), `docs/project.md` (шапка с `stage: idea`, `standard: 1`), `docs/.standard.json` (`{"ignore": []}`), `docs/backlog/2026-01-01-first-task.md`, `.gitkeep` в остальных папках.
- [ ] **Step 4:** Написать `standard/workflow.yml`:
  - `on`: `pull_request`, `push` в `main` и `claude/**`, `schedule` (`17 2 * * *`), `workflow_dispatch`;
  - `permissions: contents: read` на уровне файла;
  - задание `lint` (`ubuntu-latest`, не на `schedule`): checkout репозитория; checkout `dkicekeeper/Warehouse` (`ref: main`, `path: .warehouse`, `sparse-checkout: standard`); `python3 -I .warehouse/standard/lint.py --root .`;
  - задание `sync` (`ubuntu-latest`, только `schedule` и `workflow_dispatch`, `permissions: contents: write`): те же checkout; `python3 -I .warehouse/standard/sync_block.py CLAUDE.md`; если `git diff --quiet CLAUDE.md` говорит «изменён» — коммит `Update the Warehouse standard block` от `github-actions[bot]` и пуш в `main`. Папка `.warehouse` в коммит не попадает.
- [ ] **Step 5:** Тест зелёный; `pnpm test`, `pnpm lint`, `pnpm typecheck` зелёные; коммит `Standard: project template and workflow`.

### Task 7: Переезд Warehouse

**Files:**
- Move: `docs/superpowers/specs/2026-11-25-dispatch-design.md` → `docs/archive/plans/`; `docs/superpowers/plans/2026-11-25-dispatch.md` → `docs/archive/plans/2026-11-25-dispatch-plan.md`; `docs/superpowers/specs/2026-11-26-project-standard-design.md` → `docs/plans/`; этот файл → `docs/plans/2026-11-26-project-standard.md` (имя сохранено: по нему названа рабочая папка исполнения); `ops/setup.md` → `docs/setup.md`; `ops/reconcile-prompt.md` → `docs/archive/`
- Create: `docs/README.md`, `docs/project.md`, `docs/.standard.json`, `docs/backlog/*.md`, `docs/decisions/*.md`, `.github/workflows/standard.yml`
- Modify: `CLAUDE.md`, `docs/roadmap.md`, `hooks/claude-md-snippet.md`, `hooks/README.md`

- [ ] **Step 1:** Найти все упоминания переносимых путей: `grep -rn "superpowers\|ops/setup\|ops/reconcile" --include="*.md" --include="*.ts" --include="*.tsx" --include="*.yml" --include="*.py" . --exclude-dir=node_modules --exclude-dir=.next`.
- [ ] **Step 2:** Перенести файлы `git mv`; добавить шапки: дизайн и план диспетчерской — `status: done`; дизайн стандарта — `status: done`, `kind: design`, `approved: 2026-11-26`; этот план — `kind: plan`, `status: done`, `approved: 2026-11-26`.
- [ ] **Step 3:** Создать задачи. Подсистемы 3–8 дорожной карты — по задаче `idea`, `priority: 3` (метрики — `priority: 2`), `size: l`. Отложенные замечания ревью диспетчерской — по задаче `ready`, `type: bug` или `chore`, `size: s|m`: гонка записи строки PR; доставка записывается до применения; устаревший `mergeable`; набор символов `session_id`; отмена любого незавершённого прогона; бесконечный повтор правки удалённого сообщения Telegram; `main_red` истекает через 14 дней; выученный лимит macOS только растёт; переименование репозитория; названия сессий без сверки. Непроверенное на боевом сервисе (cron Vercel, расписание GitHub, очередь под нагрузкой, утренняя сводка) — одна задача `ready`, `type: chore`.
- [ ] **Step 4:** Создать решения (`by: owner`, даты из спецификаций): репозиторий публичный; без Supabase, база в Neon; страница и Telegram; часовая сверка не настроена (`by: claude`); глубина стандарта — полная унификация; задачи — файл на задачу.
- [ ] **Step 5:** `docs/project.md` (`stage: live`, `kind: service`, `platforms: [web]`), `docs/README.md` (строка на `roadmap.md`, `setup.md`), `docs/.standard.json`; исправить ссылки в `CLAUDE.md`, `roadmap.md`, `setup.md`.
- [ ] **Step 6:** `CLAUDE.md`: удалить раздел «Строка состояния для Warehouse», запустить `python3 -I standard/sync_block.py CLAUDE.md`. `hooks/claude-md-snippet.md` заменить одной строкой-ссылкой на `standard/agents.md`; `hooks/README.md` — шаг «раздел в CLAUDE.md» заменить на «workflow standard.yml».
- [ ] **Step 7:** `.github/workflows/standard.yml`: как `standard/workflow.yml`, но `lint` и `sync` берут `standard/` из своего checkout (второй checkout не нужен). Добавить тест в `tests/standard/template.test.ts`: `runLint` на корне самого репозитория → код 0.
- [ ] **Step 8:** `python3 -I standard/lint.py` → 0; `pnpm test && pnpm lint && pnpm typecheck` зелёные; коммит, пуш, PR «Project standard: tooling and Warehouse on it»; CI зелёный. **Мерж владельца.**

### Tasks 8–12: Переезд Baja.kz, Platina, Dalada, DesignKit, Tenra

По одной задаче на репозиторий, в этом порядке; следующий начинается после мержа задачи 7 (проекты берут `standard/` из `main` Warehouse). Ветка `claude/project-standard` от свежего `main`.

**Процедура (одинакова):**

- [ ] **Step 1:** Проверить открытые PR репозитория (`list_pull_requests`); назвать владельцу те, что трогают `docs/` или `CLAUDE.md`, до начала.
- [ ] **Step 2:** Найти документы, которые читают инструменты: `grep -rnE "docs/[A-Za-z0-9_./-]+" .github scripts <каталоги кода>`; и старые пути этого репозитория в остальных пяти. Результат — список «остаётся / меняется вместе со ссылкой».
- [ ] **Step 3:** Перенести файлы `git mv` по строке репозитория из таблицы спецификации «По репозиториям».
- [ ] **Step 4:** Разобрать открытую работу по «Правилам разбора» спецификации: задачи (текст источника дословно), планы с шапкой, решения. Разобранный раздел в источнике заменить строкой-ссылкой.
- [ ] **Step 5:** `docs/project.md`, `docs/README.md` (оглавление), `docs/.standard.json` (пути из шага 2 с причиной).
- [ ] **Step 6:** `CLAUDE.md`: ссылки и раздел о документах под новое дерево; удалить раздел «Строка состояния для Warehouse»; `sync_block.py`. `.github/workflows/standard.yml` — копия `standard/workflow.yml`.
- [ ] **Step 7:** `python3 -I /home/user/Warehouse/standard/lint.py --root .` → 0. Проверки самого репозитория, которые читают документы (ниже), зелёные.
- [ ] **Step 8:** Пуш, PR с таблицей «было → стало» и счётом (задач, планов, решений — из каких разделов). CI зелёный. **Мерж владельца.** PR со ссылками в чужих репозиториях — после мержа.

**Особенности:**

- **Task 8, Baja.kz.** `kind: web`, `stage: live`. `docs/plans/*` (март 2026) → `docs/archive/plans/` без шапок. Бэклог — только то, что в `CLAUDE.md` названо несделанным; если ничего, одна задача-пример не нужна, папка с `.gitkeep`.
- **Task 9, Platina.** `PLAN.md` делится по таблице; `CLAUDE.md` Platina и `CLAUDE.md` DesignKit называют `docs/PLAN.md` — поправить оба (DesignKit — в задаче 11 или отдельным PR). Проверки: `scripts/copy_lint.py` не читает `docs/`; сервер `server/assistant/README.md` остаётся (не в `docs/`). `ios.yml` на изменение только `docs/**` и `CLAUDE.md` не должен занимать macOS: проверить `paths`/логику пропуска и сказать владельцу, если сборка всё же встанет в очередь.
- **Task 10, Dalada.** Вехи `04-beta/M*.md` и `04-beta/README.md` → `docs/archive/plans/` как есть. `docs/public/` не трогать (`pages.yml`). Ссылки на `docs/05-release/README.md` и `docs/04-beta/testflight.md` в `CLAUDE.md` и workflow — поправить в том же PR. `05-release/icon/` → `docs/archive/icon/`.
- **Task 11, DesignKit.** Пути из списка «нельзя трогать» остаются; `scripts/sync_agents_block.py`, `components_reference.py`, `release.py`, `changelog.py`, `ci_changes.py` прочитать на предмет путей до переноса. Нужна ли заметка в `.changes/` для изменения только документов — по `docs/releasing.md` и заданию `Changelog`. Блок `designkit:agents` в приложениях не затрагивается.
- **Task 12, Tenra.** Последним. Архив (492 файла) не трогается. `docs/backlog.md` → папка: в день мержа, с согласия владельца, поправить текст плановой задачи «Tenra: субботний чек роста» (`update_trigger`, только строку о разрешённых для правки путях: `docs/backlog.md` → `docs/backlog/`). `CLAUDE.md` Tenra: таблица «When to Read Which Doc», разделы Documentation и ссылки на `backlog.md` и `plan-*.md`. Правило 7 `docs/README.md` (superpowers → `docs/plan-<topic>.md`) заменяется на `docs/plans/`. Скрипты, читающие документы: `scripts/build_site.py`, `appstore/*.py`, `scripts/threads.py` — прочитать до переноса.

### Task 13: Приёмка

- [ ] **Step 1:** В каждом из шести репозиториев на `main`: `lint.py --root . --json` → код 0, есть `project`, непустые `backlog` или явное «открытых задач нет».
- [ ] **Step 2:** `sync_block.py --check CLAUDE.md` → 0 во всех шести.
- [ ] **Step 3:** Запустить `standard.yml` вручную в одном проекте (`workflow_dispatch`): задание `sync` зелёное и ничего не коммитит.
- [ ] **Step 4:** Перенести дизайн и план стандарта в `docs/archive/plans/` со статусом `done`; в `docs/roadmap.md` строка подсистемы 2 — «работает»; задача подсистемы 3 → `ready`, если владелец её выбирает.
