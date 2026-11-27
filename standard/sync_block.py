#!/usr/bin/env python3
"""Пишет standard/agents.md в CLAUDE.md проекта между метками.

    python3 -I standard/sync_block.py CLAUDE.md [--check]

Блок стоит между `<!-- warehouse:standard:start -->` и `<!-- warehouse:standard:end -->`; всё
вокруг него — правила самого проекта, их скрипт не трогает. В файле без меток блок дописывается
в конец. Код выхода: 0 — файл актуален или записан; 1 — с --check файл устарел (и не записан);
2 — метки сломаны (одна из двух или блоков больше одного), файл не тронут.
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
START = "<!-- warehouse:standard:start -->"
END = "<!-- warehouse:standard:end -->"


def read(path):
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def block():
    text = read(os.path.join(HERE, "agents.md")).strip()
    version = read(os.path.join(HERE, "VERSION")).strip()
    # У файла проекта свой заголовок: заголовки правил опускаются на уровень.
    lines, in_code = [], False
    for line in text.split("\n"):
        if line.startswith("```"):
            in_code = not in_code
        elif not in_code and re.match(r"^#+ ", line):
            line = "#" + line
        lines.append(line)
    text = "\n".join(lines)
    note = ("<!-- Стандарт Warehouse, версия %s. Не править здесь: блок переписывает workflow "
            "standard.yml из standard/agents.md репозитория Warehouse, который собирается из "
            "standard/guides/. -->" % version)
    return "%s\n%s\n\n%s\n\n%s" % (START, note, text, END)


def synced(text):
    """Текст с актуальным блоком, или None, если метки сломаны."""
    starts, ends = text.count(START), text.count(END)
    if starts == 0 and ends == 0:
        return text.rstrip("\n") + "\n\n" + block() + "\n"
    if starts != 1 or ends != 1 or text.index(START) > text.index(END):
        return None
    return text[:text.index(START)] + block() + text[text.index(END) + len(END):]


def main(argv):
    check = "--check" in argv
    paths = [arg for arg in argv if arg != "--check"]
    if len(paths) != 1:
        print("sync_block.py CLAUDE.md [--check]", file=sys.stderr)
        return 2
    path = paths[0]
    old = read(path)
    new = synced(old)
    if new is None:
        print("%s: метки warehouse:standard сломаны (нужна одна пара: start, затем end). Файл не тронут: "
              "уберите лишние метки руками." % path, file=sys.stderr)
        return 2
    if new == old:
        return 0
    if check:
        print("%s: блок стандарта устарел. Запустите sync_block.py без --check." % path)
        return 1
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(new)
    print("%s: блок стандарта обновлён." % path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
