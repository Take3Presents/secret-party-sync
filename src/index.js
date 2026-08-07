import { runSync } from './sync.js';
import { getLatestRuns } from './airtable.js';

export default {
  /**
   * Cron trigger — fires every 5 minutes. Configured in wrangler.toml.
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runSync(env, 'scheduled').catch((err) => {
        console.error('Scheduled sync failed:', err.message);
      }),
    );
  },

  /**
   * HTTP handler.
   *
   *   POST /sync    — run a sync now (Airtable button automation)
   *   GET  /status  — last run per endpoint, for health checks
   *
   * Both require the `x-webhook-secret` header.
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    const authorized = () => {
      const secret = request.headers.get('x-webhook-secret');
      return Boolean(env.WEBHOOK_SECRET) && secret === env.WEBHOOK_SECRET;
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

    if (request.method === 'POST' && url.pathname === '/sync') {
      if (!authorized()) return new Response('Unauthorized', { status: 401 });
      try {
        return json({ ok: true, summary: await runSync(env, 'manual') });
      } catch (err) {
        console.error('Webhook sync failed:', err.message);
        return json({ ok: false, error: err.message }, 500);
      }
    }

    // Health check. Reports how stale each endpoint is and how much backlog it
    // still owes, so a silent stall is visible without reading the Airtable log.
    if (request.method === 'GET' && url.pathname === '/status') {
      if (!authorized()) return new Response('Unauthorized', { status: 401 });
      try {
        const runs = await getLatestRuns(env.AIRTABLE_API_KEY);
        const now = Date.now();
        const endpoints = Object.fromEntries(
          Object.entries(runs).map(([endpoint, run]) => [endpoint, {
            ...run,
            minutesAgo: run.syncedAt ? Math.round((now - Date.parse(run.syncedAt)) / 60000) : null,
          }]),
        );
        // Cron runs every 5 minutes; 20 minutes of silence means something is wrong.
        const healthy = Object.values(endpoints).every(
          (e) => e.minutesAgo !== null && e.minutesAgo <= 20 && e.status !== 'failed',
        );
        return json({ ok: true, healthy, activeEventId: env.ACTIVE_EVENT_ID ?? null, endpoints });
      } catch (err) {
        return json({ ok: false, error: err.message }, 500);
      }
    }

    return new Response('Not found', { status: 404 });
  },
};
