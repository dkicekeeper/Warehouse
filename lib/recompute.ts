import { computeAttention } from '@/lib/domain/attention';
import { reconcileItems } from '@/lib/domain/items';
import { planNotifications } from '@/lib/domain/notify';
import { observeLimit } from '@/lib/domain/queue';
import type { Store } from '@/lib/store/store';

export interface Notifier {
  send(chatId: string, html: string): Promise<{ messageId: number }>;
  edit(chatId: string, messageId: number, html: string): Promise<void>;
}

export interface RecomputeResult {
  sent: number;
  edited: number;
  failed: number;
}

/**
 * Brings the «Ждёт вас» items in line with the current state and tells Telegram what changed.
 * Runs after every incoming event and once a minute; safe to run concurrently with itself.
 */
export async function recompute(
  store: Store,
  deps: { now: Date; notifier: Notifier; baseUrl: string },
): Promise<RecomputeResult> {
  const { now, notifier, baseUrl } = deps;
  const result: RecomputeResult = { sent: 0, edited: 0, failed: 0 };

  const [snap, settings, before] = await Promise.all([store.loadSnapshot(now), store.getSettings(), store.loadItems()]);
  await store.applyItemChanges(reconcileItems(before, computeAttention(snap, now, settings), now), now);

  const observed = observeLimit(snap.jobs, settings.observedMacosLimit);
  if (observed !== settings.observedMacosLimit) await store.patchSettings({ observedMacosLimit: observed });

  const chatId = settings.telegramChatId;
  if (chatId === null) return result;

  const plan = planNotifications(await store.loadItems(), snap.projects, now, settings, baseUrl);
  let digestDelivered = !plan.actions.some((a) => a.type === 'send' && a.digest);

  for (const action of plan.actions) {
    if (action.type === 'edit') {
      try {
        await notifier.edit(chatId, action.messageId, action.text);
        await store.markNotified([action.itemId], now, action.messageId, { [action.itemId]: action.text });
        result.edited++;
      } catch {
        result.failed++;
      }
      continue;
    }
    if (!(await store.claimNotify(action.itemIds, now))) continue;
    try {
      const { messageId } = await notifier.send(chatId, action.text);
      const texts = Object.fromEntries(action.itemIds.map((id) => [id, action.text]));
      // A digest is one message for many items; none of them owns it, so none can be edited later.
      await store.markNotified(action.itemIds, now, action.digest ? null : messageId, texts);
      if (action.digest) digestDelivered = true;
      result.sent++;
    } catch {
      await store.releaseNotify(action.itemIds).catch(() => {});
      result.failed++;
    }
  }

  if (plan.digestDue && digestDelivered) await store.patchSettings({ lastDigestAt: now });
  return result;
}
