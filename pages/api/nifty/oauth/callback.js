import { Redis } from '@upstash/redis';
const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const NIFTY_TOKEN_URL = 'https://openapi.niftypm.com/api/v1.0/oauth/token';

export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'missing_code' });

  const response = await fetch(NIFTY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.NIFTY_CLIENT_ID,
      client_secret: process.env.NIFTY_CLIENT_SECRET,
      redirect_uri: process.env.NIFTY_REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return res.status(500).json({ error: 'token_exchange_failed', detail: err });
  }

  const data = await response.json();
  await kv.set('nifty_access_token', data.access_token, { ex: 3500 });
  await kv.set('nifty_refresh_token', data.refresh_token);

  res.status(200).send(
    'Authorization complete. Kate QA API is now connected to Nifty. You can close this tab.'
  );
}
