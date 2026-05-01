import { Redis } from '@upstash/redis';

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const NIFTY_TOKEN_URL = 'https://openapi.niftypm.com/api/v1.0/oauth/token';

export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) return res.status(400).send(`Nifty OAuth error: ${error}`);
  if (!code) return res.status(400).send('Missing code parameter from Nifty');

  const credentials = `${process.env.NIFTY_CLIENT_ID}:${process.env.NIFTY_CLIENT_SECRET}`;
  const basicAuth = `Basic ${Buffer.from(credentials).toString('base64')}`;

  const response = await fetch(NIFTY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.NIFTY_REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return res.status(500).send(`Token exchange failed (${response.status}): ${err}`);
  }

  const data = await response.json();
  await kv.set('nifty_access_token', data.access_token, { ex: data.expires_in - 60 });
  await kv.set('nifty_refresh_token', data.refresh_token);

  res.status(200).send('Authorization complete. Kate QA API is connected to Nifty. You can close this tab.');
}
