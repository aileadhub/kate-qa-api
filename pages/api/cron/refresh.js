import { refreshAccessToken } from '../../../lib/nifty';

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }
  try {
    await refreshAccessToken();
    res.status(200).json({ ok: true, refreshed_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
