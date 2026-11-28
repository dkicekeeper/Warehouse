'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { duration } from './format';
import { Notice, Page } from './page';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { NativeSelect, NativeSelectOption } from './ui/native-select';
import { Skeleton } from './ui/skeleton';

interface SettingsView {
  settings: {
    workingTtlMin: number;
    notifyDelayMin: number;
    quietStart: string;
    quietEnd: string;
    timezone: string;
    macosLimit: number | null;
    observedMacosLimit: number | null;
  };
  telegram: { bound: boolean; linkCode: { code: string; expiresAt: string } | null };
  projects: { id: string; name: string; repos: string[] }[];
  looseSessions: { id: string; title: string | null }[];
  sources: { source: string; lastOkAt: string | null; lastErrorAt: string | null; note: string | null }[];
  metrics: { trialCostLimit: number; inDigest: boolean; revenuecatProjects: { id: string; name: string; projectId: string | null }[] };
}

const SOURCES: Record<string, string> = {
  github_webhook: 'Вебхуки GitHub',
  github_resync: 'Сверка с GitHub',
  session_hook: 'Отчёты сессий (хук)',
  reconcile: 'Сверка списка сессий',
};

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? '';


export function Settings() {
  const router = useRouter();
  const [view, setView] = useState<SettingsView | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings', { cache: 'no-store' });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (!res.ok) throw new Error();
      setView((await res.json()) as SettingsView);
    } catch {
      setMessage('Не удалось загрузить настройки.');
    }
  }, [router]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const send = useCallback(
    async (body: unknown, done = 'Сохранено.') => {
      setMessage(null);
      try {
        const res = await fetch('/api/settings', { method: 'POST', body: JSON.stringify(body) });
        setMessage(res.ok ? done : res.status === 400 ? 'Проверьте значения: что-то из них вне допустимых границ.' : `Не получилось (${res.status}).`);
      } catch {
        setMessage('Нет связи с сервером.');
      }
      await load();
    },
    [load],
  );

  return (
    <Page title="Настройки">
      {message && (
        <Notice tone="info">{message}</Notice>
      )}
      {!view && <Skeleton className="h-40 w-full rounded-xl" />}
      {view && (
        <>
          <Rules view={view} send={send} />
          <Telegram view={view} send={send} />
          <ProjectsBlock view={view} send={send} />
          <MetricsBlock view={view} send={send} />
          <Sources view={view} />
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="outline">Выйти</Button>
          </form>
        </>
      )}
    </Page>
  );
}

type Send = (body: unknown, done?: string) => Promise<void>;

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h2 className="text-sm font-medium">{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">{children}</CardContent>
    </Card>
  );
}

function Rules({ view, send }: { view: SettingsView; send: Send }) {
  const s = view.settings;
  const [ttl, setTtl] = useState(String(s.workingTtlMin));
  const [delay, setDelay] = useState(String(s.notifyDelayMin));
  const [start, setStart] = useState(s.quietStart);
  const [end, setEnd] = useState(s.quietEnd);
  const [limit, setLimit] = useState(s.macosLimit === null ? '' : String(s.macosLimit));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void send({
      action: 'update',
      settings: {
        workingTtlMin: Number(ttl),
        notifyDelayMin: Number(delay),
        quietStart: start,
        quietEnd: end,
        macosLimit: limit.trim() === '' ? null : Number(limit),
      },
    });
  };

  return (
    <Block title="Правила">
      <form onSubmit={save} className="space-y-3">
        <label className="flex flex-wrap items-center gap-2">
          <span className="min-w-56 flex-1">Сколько верить «работаю» без новостей, мин</span>
          <Input className="w-24" inputMode="numeric" value={ttl} onChange={(e) => setTtl(e.target.value)} />
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <span className="min-w-56 flex-1">Задержка перед «готов к мержу» и «CI упал» в Telegram, мин</span>
          <Input className="w-24" inputMode="numeric" value={delay} onChange={(e) => setDelay(e.target.value)} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-56 flex-1">Тихие часы ({s.timezone})</span>
          <Input aria-label="Начало тихих часов" type="time" className="w-auto" value={start} onChange={(e) => setStart(e.target.value)} />
          <span>—</span>
          <Input aria-label="Конец тихих часов" type="time" className="w-auto" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <label className="flex flex-wrap items-center gap-2">
          <span className="min-w-56 flex-1">
            Одновременных сборок macOS
            <span className="block text-xs text-muted-foreground">
              Пусто — брать наблюдаемое: {s.observedMacosLimit ?? 'пока не известно'}
            </span>
          </span>
          <Input className="w-24" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="авто" />
        </label>
        <Button type="submit" className="self-start">Сохранить</Button>
      </form>
    </Block>
  );
}

function MetricsBlock({ view, send }: { view: SettingsView; send: Send }) {
  const m = view.metrics;
  const [limit, setLimit] = useState(String(m.trialCostLimit));
  const [inDigest, setInDigest] = useState(m.inDigest ? 'yes' : 'no');
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void send({ action: 'update', settings: { metricsTrialCostLimit: Number(limit.replace(',', '.')), metricsInDigest: inDigest === 'yes' } });
  };
  return (
    <Block title="Метрики">
      <form onSubmit={save} className="space-y-3">
        <label className="flex flex-wrap items-center gap-2">
          <span className="min-w-56 flex-1">
            Порог цены пробного за 7 дней
            <span className="block text-xs text-muted-foreground">Дороже — заметка в «Ждёт вас». В валюте рекламного счёта.</span>
          </span>
          <Input className="w-24" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <span className="min-w-56 flex-1">Цифры за вчера в утренней сводке</span>
          <NativeSelect value={inDigest} onChange={(e) => setInDigest(e.target.value)}>
            <NativeSelectOption value="yes">Да</NativeSelectOption>
            <NativeSelectOption value="no">Нет</NativeSelectOption>
          </NativeSelect>
        </label>
        <Button type="submit" className="self-start">Сохранить</Button>
      </form>
      {m.revenuecatProjects.length > 0 && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <span className="text-xs text-muted-foreground">Проекты RevenueCat. Без выбора — проект с тем же именем.</span>
          {m.revenuecatProjects.map((rc) => (
            <label key={rc.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-56 flex-1">{rc.name}</span>
              <NativeSelect
                aria-label={`Проект для ${rc.name}`}
                value={rc.projectId ?? ''}
                onChange={(e) => void send({ action: 'linkRevenueCat', revenuecatId: rc.id, projectId: e.target.value || null })}
              >
                <NativeSelectOption value="">по имени</NativeSelectOption>
                {view.projects.map((p) => (
                  <NativeSelectOption key={p.id} value={p.id}>
                    {p.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Откуда цифры и когда собраны — на странице «Метрики».</p>
    </Block>
  );
}

function Telegram({ view, send }: { view: SettingsView; send: Send }) {
  const code = view.telegram.linkCode;
  return (
    <Block title="Telegram">
      <p>{view.telegram.bound ? 'Чат привязан: уведомления приходят.' : 'Чат не привязан: уведомления не уходят.'}</p>
      {code && (
        <p className="rounded bg-background p-2">
          Отправьте боту{BOT ? ` @${BOT}` : ''} сообщение <code className="font-mono font-semibold">/start {code.code}</code>
          <span className="block text-xs text-muted-foreground">Код одноразовый, действует 15 минут.</span>
          {BOT && (
            <a className="mt-1 block" href={`https://t.me/${BOT}?start=${code.code}`} target="_blank" rel="noreferrer">
              Открыть бота с этим кодом
            </a>
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => send({ action: 'linkTelegram' }, 'Код создан.')}>
          {view.telegram.bound ? 'Привязать другой чат' : 'Получить код привязки'}
        </Button>
        {view.telegram.bound && (
          <Button variant="outline" size="sm" onClick={() => send({ action: 'unlinkTelegram' }, 'Чат отвязан.')}>
            Отвязать
          </Button>
        )}
      </div>
    </Block>
  );
}

function ProjectsBlock({ view, send }: { view: SettingsView; send: Send }) {
  return (
    <Block title="Проекты и репозитории">
      {view.projects.length === 0 && <p className="text-muted-foreground">Появятся, когда приложение GitHub сообщит о репозиториях.</p>}
      {view.projects.map((p) => (
        <ProjectRow key={p.id} project={p} all={view.projects} send={send} />
      ))}
      {view.looseSessions.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-xs text-muted-foreground">Сессии без проекта</p>
          {view.looseSessions.map((s) => (
            <label key={s.id} className="mb-2 flex flex-wrap items-center gap-2">
              <span className="min-w-40 flex-1 break-words">{s.title ?? s.id}</span>
              <NativeSelect
                size="sm"
                defaultValue=""
                onChange={(e) => e.target.value && send({ action: 'assignSession', sessionId: s.id, projectId: e.target.value })}
              >
                <NativeSelectOption value="">проект…</NativeSelectOption>
                {view.projects.map((p) => (
                  <NativeSelectOption key={p.id} value={p.id}>
                    {p.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ))}
        </div>
      )}
    </Block>
  );
}

function ProjectRow({
  project,
  all,
  send,
}: {
  project: SettingsView['projects'][number];
  all: SettingsView['projects'];
  send: Send;
}) {
  const [name, setName] = useState(project.name);
  const others = all.filter((p) => p.id !== project.id);
  return (
    <div className="space-y-1.5">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send({ action: 'renameProject', projectId: project.id, name });
        }}
      >
        <Input aria-label={`Название проекта ${project.name}`} className="min-w-40 flex-1" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="outline" size="sm" disabled={name.trim() === '' || name === project.name}>
          Переименовать
        </Button>
      </form>
      {project.repos.map((r) => (
        <div key={r} className="flex flex-wrap items-center gap-2 pl-2 text-xs text-muted-foreground">
          <span className="min-w-40 flex-1 break-all">{r}</span>
          {others.length > 0 && (
            <NativeSelect
              aria-label={`Перенести ${r} в другой проект`}
              size="sm"
              defaultValue=""
              onChange={(e) => e.target.value && send({ action: 'moveRepo', repo: r, projectId: e.target.value })}
            >
              <NativeSelectOption value="">перенести в…</NativeSelectOption>
              {others.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </div>
      ))}
    </div>
  );
}

function Sources({ view }: { view: SettingsView }) {
  const [now] = useState(() => Date.now());
  const ago = (iso: string | null) => (iso ? `${duration(Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000)))} назад` : 'ни разу');
  return (
    <Block title="Источники данных">
      {Object.entries(SOURCES).map(([key, label]) => {
        const s = view.sources.find((x) => x.source === key);
        const failing = !!s?.lastErrorAt && (!s.lastOkAt || s.lastErrorAt > s.lastOkAt);
        return (
          <div key={key} className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span>{label}</span>
            <span className={`text-xs ${failing ? 'text-destructive' : 'text-muted-foreground'}`}>
              {failing ? `ошибка ${ago(s?.lastErrorAt ?? null)}${s?.note ? `: ${s.note}` : ''}` : `успешно ${ago(s?.lastOkAt ?? null)}`}
            </span>
          </div>
        );
      })}
    </Block>
  );
}
