import { requireApiToken } from '../../../lib/middleware';
import { listReadyForQATickets } from '../../../lib/nifty';

export default async function handler(req, res) {
  if (!requireApiToken(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const tickets = await listReadyForQATickets();
    res.status(200).json({ tickets });
  } catch (err) {
    res.status(500).json({ error: 'nifty_error', detail: err.message });
  }
}
