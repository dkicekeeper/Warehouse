---
name: Warehouse
stage: live
kind: service
platforms: [web]
standard: 1
links:
  site: https://warehouse-henna-pi.vercel.app
---
# Warehouse

Сервис владельца для ведения всех его проектов (Tenra, Dalada, Platina, DesignKit, Baja.kz и
следующих): что ждёт владельца, общая очередь сборок macOS, связь проект ↔ сессии Claude ↔ PR,
уведомления в Telegram, и стандарт ведения проекта (`standard/`), по которому устроены все
репозитории.

Сейчас: диспетчерская и стандарт ведения проекта работают с 2026-11-26, все шесть репозиториев
переведены на стандарт; панель бэклога показывает их задачи, планы и решения на сайте. Интерфейс
собран на shadcn/ui (`components/ui/`, общие части страниц в `components/page.tsx`). Что дальше — [дорожная карта](roadmap.md) и [backlog/](backlog/).
