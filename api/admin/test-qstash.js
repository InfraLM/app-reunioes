import 'dotenv/config';

/**
 * POST /api/admin/test-qstash  body: { conference_id }
 *
 * Endpoint temporário de diagnóstico. Tenta publicar uma mensagem no QStash
 * e retorna o status exato + resposta do QStash (sem vazar credencial).
 *
 * Protegido por CRON_SECRET.
 */
export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { conference_id: conferenceId } = req.body || {};
  if (!conferenceId) return res.status(400).json({ error: 'conference_id é obrigatório' });

  const qstashToken = process.env.QSTASH_TOKEN;
  const appUrl = process.env.APP_URL;
  const cronSecret = process.env.CRON_SECRET || '';

  const diagnostics = {
    has_qstash_token: !!qstashToken,
    qstash_token_len: qstashToken?.length || 0,
    qstash_token_prefix: qstashToken ? qstashToken.slice(0, 6) + '...' : null,
    has_app_url: !!appUrl,
    app_url: appUrl,
    has_cron_secret: !!cronSecret,
  };

  if (!qstashToken || !appUrl) {
    return res.status(500).json({ error: 'QSTASH_TOKEN ou APP_URL ausentes', diagnostics });
  }

  const targetUrl = `${appUrl}/api/cron/generate-ata`;
  const publishUrl = 'https://qstash.upstash.io/v2/publish/' + encodeURIComponent(targetUrl);

  try {
    const qstashRes = await fetch(publishUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${qstashToken}`,
        'Content-Type': 'application/json',
        'Upstash-Delay': '0s',
        'Upstash-Forward-Authorization': `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({ conference_id: conferenceId }),
    });
    const bodyText = await qstashRes.text();
    let bodyJson = null;
    try { bodyJson = JSON.parse(bodyText); } catch {}

    return res.status(200).json({
      diagnostics,
      qstash: {
        status: qstashRes.status,
        ok: qstashRes.ok,
        body: bodyJson || bodyText.slice(0, 2000),
        headers: {
          'content-type': qstashRes.headers.get('content-type'),
        },
        publish_url: publishUrl.slice(0, 100) + '...',
      },
    });
  } catch (err) {
    return res.status(500).json({
      diagnostics,
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 5).join('\n'),
    });
  }
}
