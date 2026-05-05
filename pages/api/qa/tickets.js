import { requireApiToken } from '../../../lib/middleware';
import { listAllQATickets, listReadyForQATickets, listQAStatusTickets } from '../../../lib/nifty';

export default async function handler(req, res) {
  if (!requireApiToken(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();

  try {
    // ?status=ready_for_qa  → only "Ready for QA" tickets (legacy)
    // ?status=qa            → only "QA" column tickets
    // (default)             → both combined
    const { status } = req.query;
    let result;
    if (status === 'ready_for_qa') result = await listReadyForQATickets();
    else if (status === 'qa') result = await listQAStatusTickets();
    else result = await listAllQATickets();

    const body = { tickets: result.tickets };
    if (result.errors.length > 0) body.errors = result.errors;
    res.status(200).json(body);
  } catch (err) {
    res.status(500).json({ error: 'nifty_error', detail: err.message });
  }
}
