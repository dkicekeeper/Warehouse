#!/usr/bin/env python3
"""Собирает standard/agents.md — блок правил для CLAUDE.md проектов — из гайдлайнов.

    python3 -I standard/build_agents.py [--check] [--guides DIR] [--out FILE]
    python3 -I standard/build_agents.py --ids [--guides DIR]

Берёт раздел «## Коротко для агента» каждого гайдлайна в порядке оглавления guides/README.md и
ставит его под заголовком гайдлайна. Номера правил (DOC-2) в тексте ведут к полному правилу. Блок
пишет в проекты sync_block.py. Код выхода: 0 — файл актуален или записан; 1 — с --check файл
устарел (и не записан).

--ids печатает номера всех правил, по одному на строку, по алфавиту: тест сверяет их с разбором
гайдлайнов на сайте (lib/domain/guides.ts).
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
AGENT_HEADING = "## Коротко для агента"
RULE = re.compile(r"^### ([A-Z]+-\d+)\. ")
GUIDES_URL = "https://github.com/dkicekeeper/Warehouse/tree/main/standard/guides"

HEADER = """# Стандарт ведения проекта

Один порядок во всех проектах владельца. Правила целиком, с причинами и способами проверки, — в
[гайдлайнах](%s) репозитория Warehouse (их же показывает сайт Warehouse, раздел «Гайдлайны»);
номер в скобках, например (DOC-2), — номер правила там. Документы проверяет CI (workflow
`standard.yml`); локально: `python3 -I <Warehouse>/standard/lint.py --root .`
""" % GUIDES_URL


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read().replace("\r\n", "\n")


def order(guides_dir):
    """Файлы гайдлайнов в порядке оглавления README.md."""
    index = read(os.path.join(guides_dir, "README.md"))
    return re.findall(r"^\d+\. \[[^\]]+\]\(([a-z-]+\.md)\)", index, re.M)


def parts(text):
    """Заголовок гайдлайна, его правила (номера) и раздел для агента."""
    lines = text.split("\n")
    title = next((l[2:].strip() for l in lines if l.startswith("# ")), "")
    ids, agent, in_code, in_agent = [], [], False, False
    for line in lines:
        if line.strip() == AGENT_HEADING:
            in_agent = True
            continue
        if in_agent:
            agent.append(line)
            continue
        if line.startswith("```"):
            in_code = not in_code
        m = None if in_code else RULE.match(line)
        if m:
            ids.append(m.group(1))
    return title, ids, "\n".join(agent).strip()


def build(guides_dir):
    sections = [HEADER.rstrip()]
    for name in order(guides_dir):
        title, _, agent = parts(read(os.path.join(guides_dir, name)))
        if agent:
            sections.append("## %s\n\n%s" % (title, agent))
    return "\n\n".join(sections) + "\n"


def main(argv):
    guides_dir = os.path.join(HERE, "guides")
    out = os.path.join(HERE, "agents.md")
    args = list(argv)
    if "--guides" in args:
        guides_dir = args[args.index("--guides") + 1]
    if "--out" in args:
        out = args[args.index("--out") + 1]
    if "--ids" in args:
        ids = []
        for name in order(guides_dir):
            ids += parts(read(os.path.join(guides_dir, name)))[1]
        print("\n".join(sorted(ids)))
        return 0
    text = build(guides_dir)
    old = read(out) if os.path.exists(out) else None
    if old == text:
        return 0
    if "--check" in args:
        print("%s устарел относительно гайдлайнов. Запустите python3 -I standard/build_agents.py." % out)
        return 1
    with open(out, "w", encoding="utf-8") as f:
        f.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
