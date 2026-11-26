'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { duration } from './format';

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
}

const SOURCES: Record<string, string> = {
  github_webhook: 'Вебхуки GitHub',
  github_resync: 'Сверка с GitHub',
  session_hook: 'Отчёты сессий (хук)',
  reconcile: 'Сверка списка сессий',
};

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? '';

const input = 'min-h-9 rounded border border-line bg-paper px-2 text-sm text-ink';
const button = 'min-h-9 rounded border border-line bg-paper px-3 text-sm hover:border-muted disabled:opacity-50';

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
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Настройки</h1>
        <Link href="/" className="text-xs">
          ← к панели
        </Link>
      </header>
      {message && (
        <p role="status" className="mt-3 rounded-md border border-line bg-panel px-3 py-2 text-sm">
          {message}
        </p>
      )}
      {view && (
        <>
          <Rules view={view} send={send} />
          <Telegram view={view} send={send} />
          <ProjectsBlock view={view} send={send} />
          <Sources view={view} />
          <form action="/auth/signout" method="post" className="mt-8">
            <button className={button}>Выйти</button>
          </form>
        </>
      )}
    </div>
  );
}

type Send = (body: unknown, done?: string) => Promise<void>;

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="space-y-3 rounded-lg border border-line bg-panel p-3 text-sm">{children}</div>
    </section>
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
          <input className={`${input} w-24`} inputMode="numeric" value={ttl} onChange={(e) => setTtl(e.target.value)} />
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <span className="min-w-56 flex-1">Задержка перед «готов к мержу» и «CI упал» в Telegram, мин</span>
          <input className={`${input} w-24`} inputMode="numeric" value={delay} onChange={(e) => setDelay(e.target.value)} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-56 flex-1">Тихие часы ({s.timezone})</span>
          <input aria-label="Начало тихих часов" type="time" className={input} value={start} onChange={(e) => setStart(e.target.value)} />
          <span>—</span>
          <input aria-label="Конец тихих часов" type="time" className={input} value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <label className="flex flex-wrap items-center gap-2">
          <span className="min-w-56 flex-1">
            Одновременных сборок macOS
            <span className="block text-xs text-muted">
              Пусто — брать наблюдаемое: {s.observedMacosLimit ?? 'пока не известно'}
            </span>
          </span>
          <input className={`${input} w-24`} inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="авто" />
        </label>
        <button className={button}>Сохранить</button>
      </form>
    </Block>
  );
}

function Telegram({ view, send }: { view: SettingsView; send: Send }) {
  const code = view.telegram.linkCode;
  return (
    <Block title="Telegram">
      <p>{view.telegram.bound ? 'Чат привязан: уведомления приходят.' : 'Чат не привязан: уведомления не уходят.'}</p>
      {code && (
        <p className="rounded bg-paper p-2">
          Отправьте боту{BOT ? ` @${BOT}` : ''} сообщение <code className="font-mono font-semibold">/start {code.code}</code>
          <span className="block text-xs text-muted">Код одноразовый, действует 15 минут.</span>
          {BOT && (
            <a className="mt-1 block" href={`https://t.me/${BOT}?start=${code.code}`} target="_blank" rel="noreferrer">
              Открыть бота с этим кодом
            </a>
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button className={button} onClick={() => send({ action: 'linkTelegram' }, 'Код создан.')}>
          {view.telegram.bound ? 'Привязать другой чат' : 'Получить код привязки'}
        </button>
        {view.telegram.bound && (
          <button className={button} onClick={() => send({ action: 'unlinkTelegram' }, 'Чат отвязан.')}>
            Отвязать
          </button>
        )}
      </div>
    </Block>
  );
}

function ProjectsBlock({ view, send }: { view: SettingsView; send: Send }) {
  return (
    <Block title="Проекты и репозитории">
      {view.projects.length === 0 && <p className="text-muted">Появятся, когда приложение GitHub сообщит о репозиториях.</p>}
      {view.projects.map((p) => (
        <ProjectRow key={p.id} project={p} all={view.projects} send={send} />
      ))}
      {view.looseSessions.length > 0 && (
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-xs text-muted">Сессии без проекта</p>
          {view.looseSessions.map((s) => (
            <label key={s.id} className="mb-2 flex flex-wrap items-center gap-2">
              <span className="min-w-40 flex-1 break-words">{s.title ?? s.id}</span>
              <select
                className={input}
                defaultValue=""
                onChange={(e) => e.target.value && send({ action: 'assignSession', sessionId: s.id, projectId: e.target.value })}
              >
                <option value="">проект…</option>
                {view.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
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
        <input aria-label={`Название проекта ${project.name}`} className={`${input} min-w-40 flex-1`} value={name} onChange={(e) => setName(e.target.value)} />
        <button className={button} disabled={name.trim() === '' || name === project.name}>
          Переименовать
        </button>
      </form>
      {project.repos.map((r) => (
        <div key={r} className="flex flex-wrap items-center gap-2 pl-2 text-xs text-muted">
          <span className="min-w-40 flex-1 break-all">{r}</span>
          {others.length > 0 && (
            <select
              aria-label={`Перенести ${r} в другой проект`}
              className={`${input} text-xs`}
              defaultValue=""
              onChange={(e) => e.target.value && send({ action: 'moveRepo', repo: r, projectId: e.target.value })}
            >
              <option value="">перенести в…</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
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
            <span className={`text-xs ${failing ? 'text-bad' : 'text-muted'}`}>
              {failing ? `ошибка ${ago(s?.lastErrorAt ?? null)}${s?.note ? `: ${s.note}` : ''}` : `успешно ${ago(s?.lastOkAt ?? null)}`}
            </span>
          </div>
        );
      })}
    </Block>
  );
}
