# Хук отчёта сессии

`warehouse-report.py` — хук для Claude Code на два события. На `Stop` (конец хода) он отправляет
сервису Warehouse конец последнего сообщения Claude (в нём строка `Статус: …`), id сессии,
репозиторий и ветку. На `UserPromptSubmit` (владелец написал в сессию) — только то, что сессия
снова работает; текст владельца не отправляется никогда. Без второго события просьба, на которую
владелец уже ответил, висела бы в «Ждёт вас» до конца следующего хода, а новая просьба той же
сессии не давала бы нового уведомления. Сервер разбирает строку состояния сам, поэтому формат можно менять без правок в
репозиториях проектов.

Хук ничего не печатает, всегда завершается с кодом 0 и сдаётся через 5 секунд. Пока адрес сервиса
не задан (`DEFAULT_URL` в скрипте или переменная `WAREHOUSE_URL`), он не отправляет ничего.

## Как поставить в репозиторий проекта

1. Скопировать `warehouse-report.py` в `.claude/hooks/warehouse-report.py`.
2. Добавить в `.claude/settings.json` (слить с существующим `hooks`, если он есть):

   ```json
   {
     "hooks": {
       "Stop": [
         { "hooks": [{ "type": "command", "command": "python3 \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/warehouse-report.py >/dev/null 2>&1 || true", "timeout": 10 }] }
       ],
       "UserPromptSubmit": [
         { "hooks": [{ "type": "command", "command": "python3 \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/warehouse-report.py >/dev/null 2>&1 || true", "timeout": 10 }] }
       ]
     }
   }
   ```

3. Добавить `.github/workflows/standard.yml` (копия `standard/workflow.yml`): он проверяет дерево
   `docs/` и пишет в `CLAUDE.md` проекта блок стандарта с разделом о строке состояния.

## Уровень окружения: сессия с несколькими репозиториями

Сессия, у которой несколько репозиториев, работает из общей папки над ними (`/home/user`). Своих
настроек у этой папки нет, и хук репозитория там не регистрируется. Поэтому облачное окружение
ставит хук для пользователя своим скриптом настройки:

```bash
mkdir -p "$HOME/.claude/hooks"
H="$HOME/.claude/hooks/warehouse-report.py"
if [ -f Warehouse/hooks/warehouse-report.py ]; then cp Warehouse/hooks/warehouse-report.py "$H"
else curl -fsSL --max-time 20 -o "$H" https://raw.githubusercontent.com/dkicekeeper/Warehouse/main/hooks/warehouse-report.py || true; fi
if [ -f "$H" ]; then python3 "$H" --install || true; fi
```

`--install` дописывает хук в `~/.claude/settings.json` на оба события, не трогая остальное и не
повторяясь. Из папки над репозиториями хук отчитывается за тот, где работали последним (по времени
`.git/index` и `.git/logs/HEAD`). Если в одном ходе сработали обе копии (репозитория и
пользователя), отчёт уходит один раз.

Токен в репозиторий не кладётся. В облачных сессиях его подставляет прокси окружения (сетевой
секрет для хоста сервиса, заголовок `Authorization`, префикс `Bearer`); для локальных сессий —
переменная `WAREHOUSE_REPORT_TOKEN` в окружении оболочки.

Нужны `python3`, `git` и `curl` — они есть и в облачном образе, и на Mac с Xcode.
