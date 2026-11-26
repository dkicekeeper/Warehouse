# Развёртывание диспетчерской

Что нужно сделать один раз, чтобы сервис заработал. У каждого шага указано, кто его делает:
**владелец** — действия в чужих кабинетах, которые нельзя сделать из сессии; **Claude** — всё
остальное, из облачной сессии с подключёнными Supabase и Vercel.

Секреты нигде не записываются в репозиторий и не вставляются в чат: только в переменные Vercel,
в Vault Supabase и в сетевые секреты окружений Claude.

## 1. База (Claude; создание проекта подтверждает владелец)

1. Проект Supabase, регион поближе к Vercel.
2. Применить миграции по порядку: `0001_schema.sql`, `0003_seed_projects.sql`.
   `0002_tick_cron.sql` — в шаге 6, когда известен адрес сервиса.
3. Authentication → Providers: включить GitHub (нужны Client ID и Secret приложения OAuth — шаг 3),
   выключить вход по почте. URL Configuration: Site URL = адрес сервиса, Redirect URL =
   `<адрес>/auth/callback`.
4. Взять строку подключения **Transaction pooler** (порт 6543) — это `DATABASE_URL`.

## 2. Сервис (Claude)

Проект Vercel из репозитория `dkicekeeper/Warehouse`, ветка `main`. Переменные окружения
(Production), имена — как в `.env.example`:

| Переменная | Откуда |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `DATABASE_URL` | шаг 1.4 |
| `OWNER_GITHUB_ID` | числовой id аккаунта владельца: `https://api.github.com/users/dkicekeeper` → `id` |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | шаг 3 |
| `REPORT_TOKEN`, `CRON_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | три случайные строки по 32+ символа (`openssl rand -hex 32`) |
| `TELEGRAM_BOT_TOKEN`, `NEXT_PUBLIC_TELEGRAM_BOT` | шаг 4 (токен и имя бота без `@`) |
| `PUBLIC_BASE_URL` | адрес сервиса без завершающего `/` |

`GITHUB_APP_PRIVATE_KEY` — PEM целиком; переводы строк можно записать как `\n`.

## 3. GitHub (владелец)

**Приложение GitHub** — Settings → Developer settings → GitHub Apps → New GitHub App:

- Webhook URL: `<адрес>/api/github/webhook`; Webhook secret: значение `GITHUB_WEBHOOK_SECRET`.
- Repository permissions: **Actions — Read and write** (запись нужна только для отмены сборки),
  **Pull requests — Read-only**, **Contents — Read-only** (коммиты PR, чтобы найти сессию),
  **Metadata — Read-only**.
- Subscribe to events: **Pull request**, **Push**, **Workflow run**, **Workflow job**.
- Where can this app be installed: Only on this account.

После создания: сгенерировать private key (скачается `.pem`), записать App ID. Установить
приложение (Install App) на репозитории: Warehouse, Tenra, tenra-assets, Dalada, Platina,
DesignKit, AutoParts4x4. Значения — в переменные Vercel (шаг 2).

**Приложение OAuth для входа** — Developer settings → OAuth Apps → New OAuth App:
Authorization callback URL берётся со страницы провайдера GitHub в Supabase
(`https://<ref>.supabase.co/auth/v1/callback`). Client ID и Secret — в Supabase (шаг 1.3).

## 4. Telegram (бота создаёт владелец, остальное Claude)

1. В `@BotFather`: `/newbot` → имя и токен. Токен — в `TELEGRAM_BOT_TOKEN`.
2. Привязать вебхук (один раз, с машины, где есть токен):

   ```bash
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     --data-urlencode "url=<адрес>/api/telegram/webhook" \
     --data-urlencode "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
     --data-urlencode 'allowed_updates=["message"]'
   ```

3. Владелец открывает `<адрес>/settings` → «Получить код привязки» → отправляет боту
   `/start <код>` из личного чата. Бот отвечает «Готово…».

## 5. Сессии Claude

1. **Адрес сервиса в хуке (Claude):** вписать его в `DEFAULT_URL` в `hooks/warehouse-report.py`.
   Пока он пуст, хук ничего не отправляет.
2. **Сетевой секрет (Claude запрашивает форму, значение вставляет владелец):** в каждом окружении
   Claude Code, где идут сессии проектов (как минимум Default и Tenra), — секрет для хоста
   сервиса: заголовок `Authorization`, префикс `Bearer`, значение `REPORT_TOKEN`. Сохранение
   секрета заодно разрешает этот хост в сетевой политике окружения.
3. **Локальные сессии на Mac (владелец):** `export WAREHOUSE_REPORT_TOKEN=…` в профиле оболочки.
4. **Часовая сверка (Claude):** плановая задача с текстом из `ops/reconcile-prompt.md`
   (подставить адрес), раз в час, новая сессия на каждый запуск.
5. **Хук в репозиториях проектов (Claude; мерж — владелец):** по одному PR, как описано в
   `hooks/README.md`, в порядке Platina → DesignKit → Dalada → AutoParts4x4 → Tenra, после того
   как на Warehouse проверено, что отчёт доходит.

## 6. Минутный тик (Claude)

В SQL-редакторе Supabase сохранить два значения в Vault и применить `0002_tick_cron.sql`:

```sql
select vault.create_secret('<адрес>/api/cron/tick', 'warehouse_tick_url');
select vault.create_secret('<CRON_TOKEN>', 'warehouse_cron_token');
```

> Не проверено: синтаксис `0002_tick_cron.sql` (pg_cron + pg_net + Vault) написан по памяти и в
> тестах не исполняется. Перед применением сверить с документацией Supabase. Проверка после
> применения: через две минуты в `<адрес>/settings` источник «Сверка с GitHub» показывает
> «успешно … назад».

Если на плане проекта нет pg_cron или pg_net — запасной вариант: workflow GitHub Actions по
расписанию `*/5 * * * *` на `ubuntu-latest`, который делает тот же `POST` с `CRON_TOKEN` из
секретов репозитория. Тогда отложенные уведомления и утренняя сводка опаздывают до 5 минут.

## 7. Приёмка (§6 спецификации)

1. Страница с телефона, вход, три блока с данными шести проектов.
2. Сессия в Warehouse заканчивает ход строкой `Статус: ждёт владельца — …` → пункт на странице и
   сообщение в Telegram в пределах минуты.
3. Пуш в рабочую ветку DesignKit или Platina → строка в очереди в пределах минуты, с веткой и
   сессией; после завершения сборки исчезает.
4. Второй пуш в ту же ветку Tenra → первый прогон помечен «устарел», кнопка его отменяет.
5. Мерж PR убирает «готов к мержу» без действий на странице.
6. Временно сменить секрет вебхука в приложении GitHub → предупреждение на главной не позже чем
   через час; вернуть.
7. `curl` без входа на `/`, `/api/board`, `/api/items/x` и на приёмники без подписи и токена —
   ни одного байта данных (это же проверяет `pnpm test:e2e`).
8. `pnpm test` и `pnpm test:e2e` зелёные.

## Что не покрыто тестами до развёртывания

- `lib/store/db.ts` — подключение к настоящему Postgres через пулер (10 строк; сам SQL хранилища
  проверен на встроенном Postgres).
- Вход через GitHub в Supabase (`/auth/callback`): проверяется шагом 7.1.
- `0002_tick_cron.sql` — см. шаг 6.
- Хук в настоящей облачной сессии: что событие `Stop` несёт `last_assistant_message`, а прокси
  окружения подставляет токен. Проверяется шагом 7.2.
