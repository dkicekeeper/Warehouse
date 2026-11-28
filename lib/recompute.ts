import { computeAttention } from '@/lib/domain/attention';
import { reconcileItems } from '@/lib/domain/items';
import { planNotifications } from '@/lib/domain/notify';
import { observeLimit } from '@/lib/domain/queue';
import type { Store } from '@/lib/store/store';
import { MessageGone } from '@/lib/telegram/client';

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
      } catch (err) {
        if (err instanceof MessageGone) {
          // The owner deleted it: keep the item, forget the message, so no tick edits it again.
          await store.markNotified([action.itemId], now, null, { [action.itemId]: action.text }).catch(() => {});
          continue;
        }
        result.failed++;
      }
      continue;
    }
    if (!(await store.claimNotify(action.itemIds, now))) continue;
    const delivered = await deliver(action.itemIds, action.text, action.digest);
    if (delivered) {
      if (action.digest) digestDelivered = true;
      continue;
    }
    // A digest that Telegram refuses must not take the requests down with it.
    for (const single of action.fallback ?? []) {
      if (await store.claimNotify([single.itemId], now)) await deliver([single.itemId], single.text, false);
    }
  }

  /** Sends one message and records it. False only when Telegram did not take the message. */
  async function deliver(itemIds: string[], text: string, digest: boolean): Promise<boolean> {
    let messageId: number;
    try {
      ({ messageId } = await notifier.send(chatId as string, text));
    } catch {
      await store.releaseNotify(itemIds).catch(() => {});
      result.failed++;
      return false;
    }
    result.sent++;
    const texts = Object.fromEntries(itemIds.map((id) => [id, text]));
    // A digest is one message for many items; none of them owns it, so none can be edited later.
    const record = () => store.markNotified(itemIds, now, digest ? null : messageId, texts);
    // The message is out. If recording it fails, the claim stays: better a late record than a
    // second copy of the same message every minute.
    await record().catch(() => record().catch(() => {}));
    return true;
  }

  if (plan.digestDue && digestDelivered) await store.patchSettings({ lastDigestAt: now });
  return result;
}
