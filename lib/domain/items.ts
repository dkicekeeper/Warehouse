import type { DesiredItem, ItemKind, ItemLevel } from './attention';

export type ItemStatus = 'open' | 'snoozed' | 'dismissed' | 'resolved';

export interface StoredItem extends DesiredItem {
  id: string;
  status: ItemStatus;
  firstSeenAt: Date;
  snoozedUntil: Date | null;
  /** The text the owner dismissed. The item comes back only when the source says something else. */
  dismissedText: string | null;
  notifiedAt: Date | null;
  notifiedText: string | null;
  telegramMessageId: number | null;
  resolvedAt: Date | null;
}

export interface ItemPatch {
  status?: ItemStatus;
  text?: string;
  kind?: ItemKind;
  level?: ItemLevel;
  projectId?: string | null;
  sessionId?: string | null;
  snoozedUntil?: Date | null;
  dismissedText?: string | null;
  notifiedAt?: Date | null;
  resolvedAt?: Date | null;
}

export interface ItemChanges {
  insert: DesiredItem[];
  update: { id: string; patch: ItemPatch }[];
}

/**
 * Brings the stored items in line with what the rules want right now.
 * `existing` holds every item that is not resolved; items are matched by key.
 */
export function reconcileItems(existing: StoredItem[], desired: DesiredItem[], now: Date): ItemChanges {
  const wanted = new Map(desired.map((d) => [d.key, d]));
  const seen = new Set<string>();
  const changes: ItemChanges = { insert: [], update: [] };

  for (const item of existing) {
    seen.add(item.key);
    const d = wanted.get(item.key);
    if (!d) {
      changes.update.push({ id: item.id, patch: { status: 'resolved', resolvedAt: now } });
      continue;
    }
    const patch: ItemPatch = {};
    if (item.status === 'dismissed') {
      if (d.text === item.dismissedText) continue;
      Object.assign(patch, { status: 'open', dismissedText: null, notifiedAt: null });
    } else if (item.status === 'snoozed' && item.snoozedUntil && item.snoozedUntil.getTime() <= now.getTime()) {
      Object.assign(patch, { status: 'open', snoozedUntil: null, notifiedAt: null });
    }
    if (d.text !== item.text) patch.text = d.text;
    if (d.kind !== item.kind) patch.kind = d.kind;
    if (d.level !== item.level) patch.level = d.level;
    if (d.projectId !== item.projectId) patch.projectId = d.projectId;
    if (d.sessionId !== item.sessionId) patch.sessionId = d.sessionId;
    if (Object.keys(patch).length > 0) changes.update.push({ id: item.id, patch });
  }

  for (const d of desired) {
    if (!seen.has(d.key)) changes.insert.push(d);
  }
  return changes;
}

export function dismissPatch(item: StoredItem): ItemPatch {
  return { status: 'dismissed', dismissedText: item.text };
}

export function snoozePatch(until: Date): ItemPatch {
  return { status: 'snoozed', snoozedUntil: until };
}
