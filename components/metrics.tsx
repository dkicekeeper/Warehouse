'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { formatMoney, type KPI, type MetricSource, type Money, type ProductMetrics } from '@/lib/domain/metrics';
import { cn } from '@/lib/utils';
import { plural } from './format';
import { EmptyRow, Notice, Page, Pill, link } from './page';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from './ui/chart';
import { Skeleton } from './ui/skeleton';

interface SourceState {
  source: MetricSource;
  configured: boolean;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  note: string | null;
  dataUntil: string | null;
}

interface MetricsResponse {
  days: 7 | 28 | 90;
  trialCostLimit: number;
  products: ProductMetrics[];
  total: { installs: KPI<number>; revenue: Money[]; adSpend: Money[] };
  sources: SourceState[];
}

const PERIODS = [7, 28, 90] as const;
const SOURCE_NAME: Record<MetricSource, string> = {
  revenuecat: 'RevenueCat',
  appstore_sales: 'Продажи App Store',
  apple_ads: 'Apple Ads',
};
const SETUP_URL = 'https://github.com/dkicekeeper/Warehouse/blob/main/docs/setup.md#метрики';

const int = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n));
const percent = (share: number) => {
  const p = share * 100;
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: Math.abs(p) < 10 ? 1 : 0 }).format(p)}%`;
};
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const when = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function useMetrics(days: number) {
  const router = useRouter();
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [failedFor, setFailedFor] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/metrics?days=${days}`, { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 401) return router.replace('/login');
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as MetricsResponse;
        if (alive) setData(body);
      })
      .catch(() => alive && setFailedFor(days));
    return () => {
      alive = false;
    };
  }, [days, router]);
  return { data: data?.days === days ? data : null, stale: data, failed: failedFor === days };
}

function Change({ kpi }: { kpi: KPI }) {
  if (kpi.change === null || kpi.value === null) return null;
  if (kpi.change === 'new') return <span className="text-xs text-muted-foreground">новое</span>;
  const up = kpi.change > 0;
  return (
    <span className={cn('text-xs tabular-nums', kpi.change === 0 ? 'text-muted-foreground' : up ? 'text-success' : 'text-destructive')}>
      {up ? '↑' : kpi.change < 0 ? '↓' : ''}
      {percent(Math.abs(kpi.change))}
    </span>
  );
}

const show = (v: number | Money | null) => (v === null ? '—' : typeof v === 'number' ? int(v) : formatMoney(v));

function Tile({ label, kpi, hint }: { label: string; kpi: KPI; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-muted/40 px-3 py-2" data-testid="metric-tile">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="text-lg font-semibold tabular-nums">{show(kpi.value)}</span>
        <Change kpi={kpi} />
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

const CHART: ChartConfig = { installs: { label: 'Установки', color: 'var(--chart-1)' } };

function DailyChart({ p }: { p: ProductMetrics }) {
  const data = p.daily.map((d) => ({ ...d, label: day(d.day) }));
  return (
    <div data-testid="metrics-chart">
      <ChartContainer config={CHART} className="aspect-auto h-40 w-full">
        <BarChart data={data} accessibilityLayer margin={{ left: 0, right: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
          <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
          <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: 0.5 }} content={<ChartTooltipContent />} />
          <Bar dataKey="installs" fill="var(--color-installs)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
      <details className="pt-1 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Таблицей</summary>
        <table className="mt-2 w-full tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-normal">День</th>
              <th className="py-1 text-right font-normal">Установки</th>
              {p.sources.includes('revenuecat') && <th className="py-1 text-right font-normal">Пробные</th>}
              {p.sources.includes('apple_ads') && <th className="py-1 text-right font-normal">Реклама</th>}
            </tr>
          </thead>
          <tbody>
            {p.daily.map((d) => (
              <tr key={d.day} className="border-t">
                <td className="py-1">{day(d.day)}</td>
                <td className="py-1 text-right">{int(d.installs)}</td>
                {p.sources.includes('revenuecat') && <td className="py-1 text-right">{int(d.trials)}</td>}
                {p.sources.includes('apple_ads') && (
                  <td className="py-1 text-right">{formatMoney({ amount: d.adSpend, currency: p.adSpend.value?.currency ?? 'USD' })}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function ProductCard({ p, limit }: { p: ProductMetrics; limit: number | null }) {
  const has = (s: MetricSource) => p.sources.includes(s);
  const missing = (['appstore_sales', 'revenuecat', 'apple_ads'] as MetricSource[]).filter((s) => !has(s));
  const prices: string[] = [];
  if (p.costPerInstall) prices.push(`Установка из рекламы ${formatMoney(p.costPerInstall)}`);
  if (p.costPerTrial) prices.push(`Пробный ${formatMoney(p.costPerTrial)}${limit !== null ? ` (порог ${formatMoney({ amount: limit, currency: p.costPerTrial.currency })})` : ''}`);
  if (p.installToTrial !== null) prices.push(`Установка → пробный ${percent(p.installToTrial)}`);
  const dear = p.costPerTrial !== null && limit !== null && p.costPerTrial.amount > limit;

  return (
    <Card size="sm" data-testid="metrics-product">
      <CardHeader className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>
          <h2 className="text-base font-medium">{p.name}</h2>
        </CardTitle>
        {missing.length > 0 && (
          <span className="text-xs text-muted-foreground">не подключены: {missing.map((s) => SOURCE_NAME[s]).join(', ')}</span>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {has('appstore_sales') && (
            <Tile label="Установки" kpi={p.installs} hint={p.redownloads.value ? `и ${int(p.redownloads.value)} повторных` : undefined} />
          )}
          {has('revenuecat') && (
            <>
              <Tile label="Пробные" kpi={p.trials} />
              <Tile label="Оплаты" kpi={p.paid} />
              <Tile label="Подписки" kpi={p.actives} hint="на конец периода" />
              <Tile label="MRR" kpi={p.mrr} />
              <Tile label={p.revenue.net ? 'Выручка' : 'Выручка до комиссии'} kpi={p.revenue} hint={p.revenue.net ? 'чистыми' : undefined} />
            </>
          )}
          {has('apple_ads') && (
            <>
              <Tile label="Реклама" kpi={p.adSpend} />
              <Tile label="Установки из рекламы" kpi={p.adInstalls} />
            </>
          )}
        </div>
        {prices.length > 0 && (
          <p className={cn('text-sm', dear ? 'text-warning' : 'text-muted-foreground')}>{prices.join(' · ')}</p>
        )}
        {has('appstore_sales') && <DailyChart p={p} />}
      </CardContent>
    </Card>
  );
}

function Sources({ sources }: { sources: SourceState[] }) {
  return (
    <p className="text-xs text-muted-foreground" data-testid="metrics-sources">
      {sources.map((s, i) => (
        <span key={s.source}>
          {i > 0 && ' · '}
          {SOURCE_NAME[s.source]}:{' '}
          {!s.configured ? (
            'не настроен'
          ) : s.lastErrorAt && (!s.lastOkAt || s.lastErrorAt > s.lastOkAt) ? (
            <span className="text-destructive">ошибка {when(s.lastErrorAt)}</span>
          ) : s.lastOkAt ? (
            `собрано ${when(s.lastOkAt)}${s.dataUntil ? `, данные до ${day(s.dataUntil)}` : ''}`
          ) : (
            'ещё не собирался'
          )}
        </span>
      ))}
    </p>
  );
}

export function Metrics() {
  const [days, setDays] = useState<7 | 28 | 90>(7);
  const { data, stale, failed } = useMetrics(days);
  const shown = data ?? stale;
  const configured = shown?.sources.some((s) => s.configured) ?? true;
  const total = shown?.total;

  return (
    <Page
      title="Метрики"
      wide
      aside={
        <span className="flex gap-1.5" role="group" aria-label="Период">
          {PERIODS.map((n) => (
            <Pill key={n} small active={days === n} onClick={() => setDays(n)}>
              {n} дней
            </Pill>
          ))}
        </span>
      }
    >
      {failed && <Notice tone="error">Не удалось загрузить метрики. Обновите страницу.</Notice>}
      {!shown && !failed && <Skeleton className="h-64 w-full rounded-xl" />}
      {shown && !configured && (
        <Notice tone="info">
          Источники метрик не подключены. Положите ключи RevenueCat, App Store Connect и Apple Ads в Vercel:{' '}
          <a href={SETUP_URL} target="_blank" rel="noreferrer" className={link}>
            как это сделать
          </a>
          .
        </Notice>
      )}
      {shown && total && shown.products.length > 0 && (
        <p className="text-sm" data-testid="metrics-total">
          Все продукты за {plural(shown.days, ['день', 'дня', 'дней'])}:{' '}
          {total.installs.value !== null && (
            <>
              {plural(total.installs.value, ['установка', 'установки', 'установок'])} <Change kpi={total.installs} />
            </>
          )}
          {total.revenue.length > 0 && <> · выручка {total.revenue.map(formatMoney).join(' + ')}</>}
          {total.adSpend.length > 0 && <> · реклама {total.adSpend.map(formatMoney).join(' + ')}</>}
        </p>
      )}
      {shown && configured && shown.products.length === 0 && <EmptyRow>Цифр пока нет: первый сбор идёт в ближайшие минуты.</EmptyRow>}
      <div className={cn('flex flex-col gap-4', !data && shown && 'opacity-60')}>
        {shown?.products.map((p) => <ProductCard key={p.projectId ?? p.name} p={p} limit={shown.trialCostLimit} />)}
      </div>
      {shown && <Sources sources={shown.sources} />}
    </Page>
  );
}
