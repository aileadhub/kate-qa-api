import { requireApiToken } from '../../../../../lib/middleware';
import { updateTaskStatus } from '../../../../../lib/nifty';

const VALID_STATUSES = ['QA Complete', 'Ready for Dev', 'Ready for QA'];

export default async function handler(req, res) {
  if (!requireApiToken(req, res)) return;
  if (req.method !== 'PUT') return res.status(405).end();

  const { task_id } = req.query;
  const { status, project_id } = req.body || {};

  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'invalid_status', valid: VALID_STATUSES });
  }
  if (!project_id) {
    return res.status(400).json({ error: 'missing_project_id' });
  }

  try {
    const result = await updateTaskStatus(task_id, project_id, status);
    res.status(200).json(result);
  } catch (err) {
    if (err.message.includes('404')) {
      return res.status(404).json({ error: 'task_not_found', task_id });
    }
    res.status(500).json({ error: 'nifty_error', detail: err.message });
  }
}
