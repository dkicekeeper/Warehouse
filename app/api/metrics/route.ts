import { after } from 'next/server';
import { handleMetrics } from '@/lib/api/metrics';
import { ownerDeps } from '@/lib/api/owner-deps';
import { metricClients } from '@/lib/metrics/collect';
import { heartbeat } from '@/lib/runtime';

// Reads the request's cookie, so it is never prerendered or cached.
export async function GET(req: Request): Promise<Response> {
  const { store, now, isOwner } = ownerDeps(req);
  const clients = metricClients();
  const res = await handleMetrics(req, {
    store,
    now,
    isOwner,
    configured: { revenuecat: clients.revenuecat !== null, appstore_sales: clients.appstore !== null, apple_ads: clients.ads !== null },
  });
  if (res.ok) after(heartbeat);
  return res;
}
