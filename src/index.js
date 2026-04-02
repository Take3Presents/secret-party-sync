import { runSync } from './sync.js';

export default {
  /**
   * Cron trigger — fires every 5 minutes automatically.
   * Configured in wrangler.toml under [triggers] crons.
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runSync(env.SECRET_PARTY_API_KEY, env.AIRTABLE_API_KEY, 'scheduled').catch((err) => {
        console.error('Scheduled sync failed:', err.message);
      }),
    );
  },

  /**
   * HTTP handler — called by the Airtable button via webhook.
   *
   * Airtable automation setup:
   *   Trigger: Button field clicked
   *   Action:  Run script → HTTP request
   *     Method: POST
   *     URL:    https://secret-party-sync.<your-subdomain>.workers.dev/sync
   *     Header: x-webhook-secret: <your WEBHOOK_SECRET value>
   *
   * Only POST /sync is accepted. All other requests get a 404.
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/sync') {
      // Verify the shared secret to prevent random people triggering syncs
      const secret = request.headers.get('x-webhook-secret');
      if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }

      try {
        const summary = await runSync(env.SECRET_PARTY_API_KEY, env.AIRTABLE_API_KEY, 'manual');
        return new Response(JSON.stringify({ ok: true, summary }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('Webhook sync failed:', err.message);
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response('Not found', { status: 404 });
  },
};
