import { requireApiToken } from '../../../../../lib/middleware';
import { postComment } from '../../../../../lib/nifty';

export default async function handler(req, res) {
  if (!requireApiToken(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

  const { task_id } = req.query;
  const { body } = req.body || {};

  if (!body) return res.status(400).json({ error: 'missing_body' });

  try {
    const result = await postComment(task_id, body);
    res.status(201).json(result);
  } catch (err) {
    if (err.message.includes('404')) {
      return res.status(404).json({ error: 'task_not_found', task_id });
    }
    res.status(500).json({ error: 'nifty_error', detail: err.message });
  }
}
