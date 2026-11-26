import type * as React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** The pieces every page of the service is built from, on shadcn/ui. */

export function Page({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pb-16 pt-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {aside && <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-muted-foreground">{aside}</div>}
      </header>
      {children}
    </div>
  );
}

/** A titled card whose content is a list of rows edge to edge. */
export function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card size="sm" className="gap-0 py-0">
      <CardHeader className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b py-3">
        <CardTitle>
          <h2 className="text-sm font-medium">{title}</h2>
        </CardTitle>
        {aside && <div className="text-xs text-muted-foreground">{aside}</div>}
      </CardHeader>
      <CardContent className="px-0">{children}</CardContent>
    </Card>
  );
}

export const Rows = ({ children }: { children: React.ReactNode }) => <ul className="divide-y divide-border">{children}</ul>;

export const EmptyRow = ({ children }: { children: React.ReactNode }) => (
  <p className="px-3 py-6 text-center text-sm text-muted-foreground">{children}</p>
);

export function Notice({ tone = 'warning', role = 'status', children }: { tone?: 'warning' | 'error' | 'info'; role?: 'status' | 'alert'; children: React.ReactNode }) {
  return (
    <Alert role={role} variant={tone === 'error' ? 'destructive' : 'default'} className={tone === 'warning' ? 'border-warning/40 text-warning' : undefined}>
      <AlertDescription className={tone === 'warning' ? 'text-warning' : undefined}>{children}</AlertDescription>
    </Alert>
  );
}

export const Chip = ({ tone, children }: { tone?: 'strong' | 'good' | 'plain'; children: React.ReactNode }) => (
  <Badge variant={tone === 'strong' ? 'default' : tone === 'plain' ? 'outline' : 'secondary'} className={tone === 'good' ? 'text-success' : undefined}>
    {children}
  </Badge>
);

export const SmallButton = (props: React.ComponentProps<typeof Button>) => <Button type="button" variant="outline" size="sm" {...props} />;

/** A filter choice: pressed or not. */
export function Pill({ active, small, onClick, children }: { active: boolean; small?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" aria-pressed={active} variant={active ? 'default' : 'outline'} size={small ? 'xs' : 'sm'} className="rounded-full" onClick={onClick}>
      {children}
    </Button>
  );
}

/** Links inside rows: quiet, underlined, as shadcn sets inline links. */
export const link = 'underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground';
