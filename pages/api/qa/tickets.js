import { requireApiToken } from '../../../lib/middleware';
import { listReadyForQATickets } from '../../../lib/nifty';

export default async function handler(req, res) {
  if (!requireApiToken(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const { tickets, errors } = await listReadyForQATickets();
    const body = { tickets };
    if (errors.length > 0) body.errors = errors;
    res.status(200).json(body);
  } catch (err) {
    res.status(500).json({ error: 'nifty_error', detail: err.message });
  }
}
