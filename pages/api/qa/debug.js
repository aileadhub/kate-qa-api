import { requireApiToken } from '../../../lib/middleware';
import { getAccessToken } from '../../../lib/nifty';

const NIFTY_API = 'https://openapi.niftypm.com/api/v1.0';

// Diagnostic endpoint — three modes:
//   GET  ?project_id=UcBgrt1c0BJhl          → dump raw task/group data for a project
//   POST ?path=/tasks/Ypa2FCr3Jc/messages   → proxy raw POST to Nifty
//   PUT  ?path=/tasks/Ypa2FCr3Jc            → proxy raw PUT to Nifty
export default async function handler(req, res) {
  if (!requireApiToken(req, res)) return;

  try {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    if (req.method === 'POST' || req.method === 'PUT') {
      const { path } = req.query;
      if (!path) return res.status(400).json({ error: 'missing path query param' });
      const niftyRes = await fetch(`${NIFTY_API}${path}`, {
        method: req.method,
        headers,
        body: JSON.stringify(req.body),
      });
      const text = await niftyRes.text();
      let json;
      try { json = JSON.parse(text); } catch { json = text; }
      return res.status(niftyRes.status).json({ nifty_status: niftyRes.status, response: json });
    }

    if (req.method !== 'GET') return res.status(405).end();

    const { project_id } = req.query;
    if (!project_id) {
      return res.status(400).json({ error: 'missing_project_id', hint: 'Add ?project_id=UcBgrt1c0BJhl' });
    }

    const tasksRes = await fetch(`${NIFTY_API}/tasks?project_id=${project_id}`, { headers });
    const tasksRaw = tasksRes.ok ? await tasksRes.json() : { error: tasksRes.status, body: await tasksRes.text() };

    const tasks = Array.isArray(tasksRaw) ? tasksRaw : (tasksRaw.tasks || []);
    const groupIds = [...new Set(tasks.map((t) => t.task_group).filter(Boolean))];

    const groups = {};
    for (const gid of groupIds) {
      const gRes = await fetch(`${NIFTY_API}/taskgroups/${gid}`, { headers });
      groups[gid] = gRes.ok ? await gRes.json() : { error: gRes.status, body: await gRes.text() };
    }

    const sampleTask = tasks[0] || null;
    res.status(200).json({
      project_id,
      task_count: tasks.length,
      sample_task: sampleTask,
      sample_task_keys: sampleTask ? Object.keys(sampleTask) : null,
      group_ids_on_tasks: groupIds,
      groups,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
