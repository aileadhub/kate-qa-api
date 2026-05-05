import { requireApiToken } from '../../../lib/middleware';
import { createTask } from '../../../lib/nifty';

const VALID_SLUGS = [
  'amp-movers', 'boxstar', 'cali-moving', 'ellis-moving',
  'helix', 'macs-moving', 'potomac-movers', 'riseup-moving',
];

export default async function handler(req, res) {
  if (!requireApiToken(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

  const { client_slug, title, description } = req.body || {};

  if (!client_slug || !VALID_SLUGS.includes(client_slug)) {
    return res.status(400).json({ error: 'invalid_client_slug', valid: VALID_SLUGS });
  }
  if (!title) return res.status(400).json({ error: 'missing_title' });
  if (!description) return res.status(400).json({ error: 'missing_description' });

  try {
    const result = await createTask(client_slug, title, description);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: 'nifty_error', detail: err.message });
  }
}
