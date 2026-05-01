import { requireApiToken } from '../../../lib/middleware';
import { getAccessToken } from '../../../lib/nifty';

const NIFTY_API = 'https://openapi.niftypm.com/api/v1.0';

// Diagnostic endpoint — dumps raw Nifty task data for one project.
// Use to diagnose why /api/qa/tickets returns empty.
// Query: ?project_id=UcBgrt1c0BJhl
export default async function handler(req, res) {
  if (!requireApiToken(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();

  const { project_id } = req.query;
  if (!project_id) {
    return res.status(400).json({ error: 'missing_project_id', hint: 'Add ?project_id=UcBgrt1c0BJhl' });
  }

  try {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Fetch raw tasks
    const tasksRes = await fetch(`${NIFTY_API}/tasks?project_id=${project_id}`, { headers });
    const tasksRaw = tasksRes.ok ? await tasksRes.json() : { error: tasksRes.status, body: await tasksRes.text() };

    const tasks = Array.isArray(tasksRaw) ? tasksRaw : (tasksRaw.tasks || []);
    const groupIds = [...new Set(tasks.map((t) => t.task_group).filter(Boolean))];

    // Fetch all group names found on tasks
    const groups = {};
    for (const gid of groupIds) {
      const gRes = await fetch(`${NIFTY_API}/taskgroups/${gid}`, { headers });
      groups[gid] = gRes.ok ? await gRes.json() : { error: gRes.status, body: await gRes.text() };
    }

    // Show first task's full shape so we can see all field names
    const sampleTask = tasks[0] || null;

    res.status(200).json({
      project_id,
      task_count: tasks.length,
      tasks_raw_type: Array.isArray(tasksRaw) ? 'array' : 'object',
      tasks_raw_keys: tasksRaw && typeof tasksRaw === 'object' ? Object.keys(tasksRaw) : null,
      sample_task: sampleTask,
      sample_task_keys: sampleTask ? Object.keys(sampleTask) : null,
      group_ids_on_tasks: groupIds,
      groups,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
