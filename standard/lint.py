#!/usr/bin/env python3
"""Проверка репозитория на стандарт ведения проекта Warehouse.

    python3 -I standard/lint.py [--root DIR] [--json]

Читает дерево docs/ (паспорт, задачи, планы, решения), проверяет его по правилам стандарта
(docs/plans/2026-11-26-project-standard-design.md в Warehouse) и печатает по строке на нарушение:

    <путь от корня>: [<код>] <что не так>. <как исправить>

С --json печатает разобранное дерево и нарушения одним объектом: тем же разбором Warehouse
читает репозитории. Код выхода: 0 чисто, 1 есть нарушения, 2 проверять нечего (нет docs/).
Только стандартная библиотека.
"""

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# Папка в docs/ → имя списка в выводе.
KINDS = {"backlog": "backlog", "plans": "plans", "decisions": "decisions"}

FIELDS = {
    "backlog": ["status", "type", "priority", "size", "created", "updated", "needs-owner", "plan", "branch", "pr"],
    "plans": ["status", "kind", "created", "updated", "approved", "tasks"],
    "decisions": ["status", "decided", "by", "supersedes"],
}
PASSPORT_FIELDS = ["name", "stage", "kind", "platforms", "standard", "links"]


def standard_version():
    try:
        with open(os.path.join(HERE, "VERSION"), encoding="utf-8") as f:
            return int(f.read().strip())
    except (OSError, ValueError):
        return 0


# ---------------------------------------------------------------- шапка


def _strip_comment(value):
    """Убирает « # комментарий» вне кавычек."""
    quote = None
    for i, ch in enumerate(value):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch == "#" and (i == 0 or value[i - 1] in " \t"):
            return value[:i]
    return value


def _scalar(raw):
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
        return raw[1:-1]
    if raw in ("true", "false"):
        return raw == "true"
    if re.fullmatch(r"-?\d+", raw):
        return int(raw)
    return raw


def _value(raw):
    raw = _strip_comment(raw).strip()
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1].strip()
        return [_scalar(part) for part in inner.split(",") if part.strip()] if inner else []
    return _scalar(raw)


def parse_header(text):
    """(поля | None, тело, ошибки). None — шапки нет вовсе."""
    text = text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None, text, []
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return {}, "", ["шапка не закрыта: нет второй строки «---»"]
    fields, errors, parent = {}, [], None
    for line in lines[1:end]:
        if not line.strip() or line.strip().startswith("#"):
            continue
        match = re.match(r"^(\s*)([A-Za-z][A-Za-z0-9_-]*):(.*)$", line)
        if not match:
            errors.append("строка шапки не «ключ: значение»: " + line.strip())
            continue
        indent, key, raw = match.group(1), match.group(2), match.group(3)
        if indent:
            if parent is None or not isinstance(fields.get(parent), dict):
                errors.append("вложенный ключ «%s» без родителя" % key)
                continue
            fields[parent][key] = _value(raw)
            continue
        if not _strip_comment(raw).strip():
            fields[key] = {}
            parent = key
        else:
            fields[key] = _value(raw)
            parent = None
    return fields, "\n".join(lines[end + 1:]), errors


def title_of(body):
    in_code = False
    for line in body.split("\n"):
        if line.startswith("```"):
            in_code = not in_code
        elif not in_code and line.startswith("# "):
            return line[2:].strip()
    return None


# ---------------------------------------------------------------- дерево


def read_text(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def _records(root, folder, archived):
    base = os.path.join(root, "docs", "archive", folder) if archived else os.path.join(root, "docs", folder)
    found = []
    if not os.path.isdir(base):
        return found
    for name in sorted(os.listdir(base)):
        full = os.path.join(base, name)
        if not name.endswith(".md") or not os.path.isfile(full):
            continue
        fields, body, errors = parse_header(read_text(full))
        found.append({
            "id": name[:-3],
            "path": os.path.relpath(full, root).replace(os.sep, "/"),
            "archived": archived,
            "fields": fields,
            "body": body,
            "errors": errors,
        })
    return found


def load_tree(root):
    """Разобранное дерево: паспорт и записи с сырыми полями (для проверок и для --json)."""
    tree = {"project": None, "backlog": [], "plans": [], "decisions": []}
    passport = os.path.join(root, "docs", "project.md")
    if os.path.isfile(passport):
        fields, body, errors = parse_header(read_text(passport))
        tree["project"] = {"path": "docs/project.md", "fields": fields, "body": body, "errors": errors}
    for folder in KINDS:
        tree[folder] = _records(root, folder, False) + _records(root, folder, True)
    return tree


def public_tree(tree):
    """Форма --json: только описанные поля, отсутствующие — null."""
    out = {"standard": standard_version(), "project": None, "backlog": [], "plans": [], "decisions": []}
    project = tree["project"]
    if project is not None:
        fields = project["fields"] or {}
        item = {key: fields.get(key) for key in PASSPORT_FIELDS}
        item["platforms"] = item["platforms"] if isinstance(item["platforms"], list) else []
        item["links"] = item["links"] if isinstance(item["links"], dict) else {}
        item["title"] = title_of(project["body"])
        out["project"] = item
    for folder in KINDS:
        for record in tree[folder]:
            fields = record["fields"] or {}
            item = {"id": record["id"], "path": record["path"], "archived": record["archived"],
                    "title": title_of(record["body"])}
            for key in FIELDS[folder]:
                item[key] = fields.get(key)
            if folder == "plans" and not isinstance(item["tasks"], list):
                item["tasks"] = []
            out[folder].append(item)
    return out


# ---------------------------------------------------------------- проверки


def check_headers(tree):
    """Шапка, которую не удалось разобрать."""
    found = []
    records = [tree["project"]] if tree["project"] else []
    for folder in KINDS:
        records += tree[folder]
    for record in records:
        for error in record["errors"]:
            found.append((record["path"], "header", error + ". Шапка: строки «ключ: значение» между двумя «---»"))
    return found


FOLDERS = ["backlog", "plans", "decisions", "domains", "public", "archive"]
FREE = ("docs/archive/", "docs/public/")  # история и сайт: любые папки и имена
STAGES = ["idea", "development", "beta", "live", "maintenance"]
PROJECT_KINDS = ["ios-app", "web", "library", "service"]
NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+)+$")
LOCALE = re.compile(r"^[a-z]{2,3}(-[A-Za-z]{2,4})?\.md$")


def load_ignore(root):
    """(пути из docs/.standard.json, нарушения самого файла)."""
    path = os.path.join(root, "docs", ".standard.json")
    if not os.path.isfile(path):
        return [], []
    try:
        data = json.loads(read_text(path))
        return [str(item["path"]).strip("/") for item in data.get("ignore", [])], []
    except (ValueError, KeyError, TypeError, AttributeError):
        fix = 'Формат: {"ignore": [{"path": "docs/…", "reason": "…"}]}'
        return [], [("docs/.standard.json", "tree", "файл не читается как JSON с полем ignore. " + fix)]


def ignored(rel, ignore):
    return any(rel == item or rel.startswith(item + "/") for item in ignore)


def walk_docs(root, ignore):
    """Пути файлов docs/ от корня репозитория, без пропускаемых."""
    found = []
    for base, dirs, files in os.walk(os.path.join(root, "docs")):
        rel_base = os.path.relpath(base, root).replace(os.sep, "/")
        dirs[:] = sorted(d for d in dirs if not ignored(rel_base + "/" + d, ignore))
        for name in sorted(files):
            rel = rel_base + "/" + name
            if not ignored(rel, ignore):
                found.append(rel)
    return found


def one_of(values):
    return ", ".join(str(v) for v in values)


def check_structure(root, tree, ignore):
    found = []
    docs = os.path.join(root, "docs")
    for name in sorted(os.listdir(docs)):
        rel = "docs/" + name
        if os.path.isdir(os.path.join(docs, name)) and name not in FOLDERS and not ignored(rel, ignore):
            found.append((rel, "tree", "такой папки в стандарте нет. Разрешены: %s; документ кладётся в docs/ плоско, "
                          "неактуальное в docs/archive/, путь, который читает инструмент, вносится в docs/.standard.json"
                          % one_of(FOLDERS)))
    for name, what in (("README.md", "оглавления"), ("project.md", "паспорта проекта")):
        if not os.path.isfile(os.path.join(docs, name)):
            found.append(("docs/" + name, "tree", "нет %s. Образец: standard/template/docs/%s в Warehouse" % (what, name)))

    project = tree["project"]
    if project is not None:
        fields = project["fields"]
        if fields is None:
            found.append((project["path"], "passport", "нет шапки. Нужны поля name, stage, kind, platforms, standard"))
        else:
            def bad(message):
                found.append((project["path"], "passport", message))
            for key in ("name", "stage", "kind", "platforms", "standard"):
                if key not in fields:
                    bad("нет поля «%s». Нужны name, stage, kind, platforms, standard" % key)
            for key in fields:
                if key not in PASSPORT_FIELDS:
                    bad("неизвестное поле «%s». Допустимы: %s" % (key, one_of(PASSPORT_FIELDS)))
            if "stage" in fields and fields["stage"] not in STAGES:
                bad("stage: «%s». Допустимо: %s" % (fields["stage"], one_of(STAGES)))
            if "kind" in fields and fields["kind"] not in PROJECT_KINDS:
                bad("kind: «%s». Допустимо: %s" % (fields["kind"], one_of(PROJECT_KINDS)))
            if "standard" in fields and (isinstance(fields["standard"], bool) or not isinstance(fields["standard"], int)):
                bad("standard: «%s». Нужно целое число, версия стандарта" % fields["standard"])
            if "platforms" in fields and not isinstance(fields["platforms"], list):
                bad("platforms: нужен список в скобках, например [ios]")
            if "links" in fields and not isinstance(fields["links"], dict):
                bad("links: нужны вложенные строки «  ключ: значение»")

    files = walk_docs(root, ignore)
    readme = read_text(os.path.join(docs, "README.md")) if os.path.isfile(os.path.join(docs, "README.md")) else None
    for rel in files:
        if rel.startswith(FREE):
            continue
        name = rel.rsplit("/", 1)[1]
        if not (name.startswith(".") or name == "README.md" or NAME.match(name) or LOCALE.match(name)):
            found.append((rel, "name", "имя не по стандарту. Строчные латинские буквы и цифры, слова через дефис"))
        inner = rel[len("docs/"):]
        indexed = inner.endswith(".md") and (("/" not in inner and inner not in ("README.md", "project.md"))
                                             or inner.startswith("domains/"))
        if indexed and readme is not None and inner not in readme:
            found.append((rel, "index", "документа нет в оглавлении. Добавьте строку с «%s» в docs/README.md" % inner))
    return found


VALUES = {
    "backlog": {"status": ["idea", "ready", "in-progress", "blocked", "done", "dropped"],
                "type": ["feature", "bug", "chore", "research", "content", "growth"],
                "priority": [1, 2, 3], "size": ["s", "m", "l"]},
    "plans": {"status": ["draft", "approved", "in-progress", "done", "dropped"], "kind": ["design", "plan"]},
    "decisions": {"status": ["active", "superseded"], "by": ["owner", "claude"]},
}
REQUIRED = {"backlog": ["status", "type", "created", "updated"],
            "plans": ["status", "kind", "created", "updated"],
            "decisions": ["status", "decided", "by"]}
DATES = {"backlog": ["created", "updated"], "plans": ["created", "updated", "approved"], "decisions": ["decided"]}
CLOSED = {"backlog": ["done", "dropped"], "plans": ["done", "dropped"], "decisions": ["superseded"]}
WORKABLE = ["ready", "in-progress", "blocked"]  # статусы, с которых действует «готово к работе»
WHY = ["Зачем", "Why"]
DONE_WHEN = ["Готово, когда", "Done when"]
WAITING = ["Ждёт", "Waiting"]
DATED = re.compile(r"^\d{4}-\d{2}-\d{2}-.+")


def is_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    year, month, day = (int(part) for part in value.split("-"))
    if not 1 <= month <= 12 or day < 1:
        return False
    leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    return day <= [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]


def has_section(body, names):
    """Строка «Название: …» или заголовок «## Название»."""
    for line in body.split("\n"):
        text = line.strip().lstrip("#").strip().lower()
        if any(text == name.lower() or text.startswith(name.lower() + ":") for name in names):
            return True
    return False


def check_records(root, tree, ignore):
    found = []
    ids = {folder: {record["id"] for record in tree[folder]} for folder in KINDS}
    for folder in KINDS:
        for record in tree[folder]:
            path, fields = record["path"], record["fields"]
            if ignored(path, ignore):
                continue

            def bad(code, message):
                found.append((path, code, message))

            if fields is None:
                if not record["archived"]:
                    bad("header", "нет шапки с полями. Нужны: %s; образец в блоке стандарта в CLAUDE.md"
                        % one_of(REQUIRED[folder]))
                continue  # архив без шапки — история, не проверяется
            if record["errors"]:
                continue  # шапку не разобрать: об этом уже сказано
            if not DATED.match(record["id"]):
                bad("name", "имя без даты. Нужно <ГГГГ-ММ-ДД>-<слово>.md")
            for key in fields:
                if key not in FIELDS[folder]:
                    bad("header", "неизвестное поле «%s». Допустимы: %s" % (key, one_of(FIELDS[folder])))
            for key, allowed in VALUES[folder].items():
                if key in fields and (isinstance(fields[key], bool) or fields[key] not in allowed):
                    bad("header", "%s: «%s». Допустимо: %s" % (key, fields[key], one_of(allowed)))
            for key in DATES[folder]:
                if key in fields and not is_date(fields[key]):
                    bad("header", "%s: «%s». Нужна дата ГГГГ-ММ-ДД" % (key, fields[key]))
            status = fields.get("status")
            required = list(REQUIRED[folder])
            if folder == "backlog" and status not in (None, "idea", "dropped"):
                required += ["priority", "size"]
            if folder == "plans" and status in ("approved", "in-progress", "done"):
                required += ["approved"]
            for key in required:
                if key not in fields:
                    bad("header", "нет поля «%s». Для статуса «%s» нужны: %s" % (key, status, one_of(required)))

            closed = status in CLOSED[folder]
            if status in VALUES[folder]["status"] and closed != record["archived"]:
                home = "docs/archive/%s/" % folder if closed else "docs/%s/" % folder
                bad("place", "статус «%s» живёт в %s. Перенесите файл (git mv) или исправьте статус" % (status, home))

            if folder == "backlog" and not record["archived"] and status in WORKABLE:
                body = record["body"]
                if title_of(body) is None:
                    bad("dor", "нет заголовка «# Название задачи»")
                if not has_section(body, WHY):
                    bad("dor", "нет раздела «Зачем» (Why). Без него задача остаётся в статусе idea")
                if not has_section(body, DONE_WHEN):
                    bad("dor", "нет раздела «Готово, когда» (Done when). Без него задача остаётся в статусе idea")
                if status == "ready" and "needs-owner" in fields:
                    bad("dor", "у задачи ready открыт вопрос к владельцу (needs-owner). Статус такой задачи — blocked")
                if status == "blocked" and "needs-owner" not in fields and not has_section(body, WAITING):
                    bad("dor", "у задачи blocked нет причины. Поле needs-owner или строка «Ждёт: …»")
                if status == "in-progress" and fields.get("size") == "l" and "plan" not in fields:
                    bad("dor", "большая задача (size: l) в работе без плана. Поле plan: plans/<файл>.md")

            plan = fields.get("plan") if folder == "backlog" else None
            if plan is not None and not os.path.isfile(os.path.join(root, "docs", str(plan))):
                bad("ref", "plan: файла docs/%s нет. Путь пишется от docs/" % plan)
            if folder == "plans" and isinstance(fields.get("tasks"), list):
                for task in fields["tasks"]:
                    if task not in ids["backlog"]:
                        bad("ref", "tasks: задачи «%s» нет ни в docs/backlog/, ни в архиве" % task)
            elif folder == "plans" and "tasks" in fields:
                bad("header", "tasks: нужен список в скобках, например [2026-11-26-слово] или []")
            supersedes = fields.get("supersedes") if folder == "decisions" else None
            if supersedes is not None and supersedes not in ids["decisions"]:
                bad("ref", "supersedes: решения «%s» нет ни в docs/decisions/, ни в архиве" % supersedes)
    return found


LINK = re.compile(r"\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+\"[^\"]*\")?\s*\)")
INLINE_CODE = re.compile(r"`[^`]*`")


def check_links(root, ignore):
    """Относительные ссылки CLAUDE.md и актуальных документов ведут на существующие файлы."""
    found = []
    files = [rel for rel in walk_docs(root, ignore) if rel.endswith(".md") and not rel.startswith("docs/archive/")]
    if os.path.isfile(os.path.join(root, "CLAUDE.md")):
        files.append("CLAUDE.md")
    top = os.path.realpath(root)
    for rel in files:
        in_code = False
        for number, line in enumerate(read_text(os.path.join(root, rel)).split("\n"), 1):
            if line.lstrip().startswith("```") or line.lstrip().startswith("~~~"):
                in_code = not in_code
                continue
            if in_code:
                continue
            for match in LINK.finditer(INLINE_CODE.sub("", line)):
                target = match.group(1).strip("<>").split("#", 1)[0]
                if not target or target.startswith("/") or re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target):
                    continue
                target = re.sub(r"%([0-9A-Fa-f]{2})", lambda m: chr(int(m.group(1), 16)), target)
                full = os.path.realpath(os.path.join(root, os.path.dirname(rel), target))
                if full != top and not full.startswith(top + os.sep):
                    continue  # ведёт в другой репозиторий: отсюда не проверить
                if not os.path.exists(full):
                    found.append(("%s:%d" % (rel, number), "link",
                                  "ссылка на «%s» никуда не ведёт. Исправьте путь или уберите ссылку" % target))
    return found


def run_checks(root, tree):
    ignore, found = load_ignore(root)
    found += check_headers(tree)
    found += check_structure(root, tree, ignore)
    found += check_records(root, tree, ignore)
    found += check_links(root, ignore)
    return found


# ---------------------------------------------------------------- запуск


def main(argv):
    root, as_json = ".", False
    args = list(argv)
    while args:
        arg = args.pop(0)
        if arg == "--root" and args:
            root = args.pop(0)
        elif arg == "--json":
            as_json = True
        else:
            print("lint.py [--root DIR] [--json]", file=sys.stderr)
            return 2
    if not os.path.isdir(os.path.join(root, "docs")):
        print("%s: нет папки docs/, проверять нечего" % root, file=sys.stderr)
        return 2
    tree = load_tree(root)
    violations = sorted(set(run_checks(root, tree)))
    if as_json:
        out = public_tree(tree)
        out["violations"] = [{"path": p, "code": c, "message": m} for p, c, m in violations]
        print(json.dumps(out, ensure_ascii=False, indent=1))
    else:
        for path, code, message in violations:
            print("%s: [%s] %s" % (path, code, message))
    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
