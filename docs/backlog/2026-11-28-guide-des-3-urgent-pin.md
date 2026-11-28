---
status: idea
type: chore
created: 2026-11-28
updated: 2026-11-28
---
# Правило DES-3: Platina подняла DesignKit вручную ради срочной починки — нужен ли такой путь

Аудит 2026-11-28: версию DesignKit 8.22.2 в Platina поставила сессия (коммит «DesignKit 8.22.2:
the gate that hung the Path, fixed»), а не workflow. Причина — зависание экрана «Путь», ждать
ночного подъёма было долго. Предлагаю записать путь для срочного случая: запуск workflow
**DesignKit update** вручную (Actions → Run workflow) вместо правки пина руками.
