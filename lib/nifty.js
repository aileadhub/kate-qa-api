import { Redis } from '@upstash/redis';

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const NIFTY_API = 'https://openapi.niftypm.com/api/v1.0';
const NIFTY_TOKEN_URL = 'https://openapi.niftypm.com/oauth/token';

const PROJECT_MAP = {
  UcBgrt1c0BJhl: 'riseup-moving',
  fslejpJvVD57C: 'boxstar',
  Z7QKdCHVkc2m: 'amp-movers',
  '0tCS8B8WoLruD': 'potomac-movers',
  NlPuRYaeSjPh_: 'ellis-moving',
  RbNm9wOfG399Ts: 'cali-moving',
  '4m35tboROc': 'helix',
  TqezsE9nmG: 'macs-moving',
  utyYIrvBdn7rt: 'dependable-movers',
  cylRSFTBsGaT3: 'lending-group',
  'Kk__BrrIfw': 'absolute-movers',
  'OYdYgSDf!L': 'wise-choice-movers',
};

const SLUG_TO_PROJECT = Object.fromEntries(
  Object.entries(PROJECT_MAP).map(([k, v]) => [v, k])
);

function basicAuth() {
  const credentials = `${process.env.NIFTY_CLIENT_ID}:${process.env.NIFTY_CLIENT_SECRET}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

export async function getAccessToken() {
  const token = await kv.get('nifty_access_token');
  if (token) return token;
  // Access token expired — try using the refresh token before asking Kate to re-authorize
  return refreshAccessToken();
}

export async function refreshAccessToken() {
  const refreshToken = await kv.get('nifty_refresh_token');
  if (!refreshToken) throw new Error('No refresh token — re-run OAuth flow at /api/nifty/oauth/start');

  const res = await fetch(NIFTY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      code: '',
      redirect_uri: '',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Nifty token refresh failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  await kv.set('nifty_access_token', data.access_token, { ex: data.expires_in - 60 });
  if (data.refresh_token) await kv.set('nifty_refresh_token', data.refresh_token);
  return data.access_token;
}

async function niftyFetch(method, path, body) {
  const token = await getAccessToken();
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${NIFTY_API}${path}`, options);

  if (res.status === 401 || res.status === 403) {
    await kv.del('nifty_access_token');
    const freshToken = await refreshAccessToken();
    options.headers.Authorization = `Bearer ${freshToken}`;
    const retry = await fetch(`${NIFTY_API}${path}`, options);
    if (!retry.ok) {
      const err = await retry.text();
      throw new Error(`Nifty ${method} ${path} failed after refresh (${retry.status}): ${err}`);
    }
    return retry.json();
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Nifty ${method} ${path} failed (${res.status}): ${err}`);
  }
  return res.json();
}

async function getTaskGroupIds(projectId) {
  // Primary: tasks by project
  const data = await niftyFetch('GET', `/tasks?project_id=${projectId}&limit=100`);
  const tasks = Array.isArray(data) ? data : (data.tasks || []);
  const ids = new Set(tasks.map((t) => t.task_group).filter(Boolean));

  // Fallback: tasks by milestone — catches groups the project query misses (e.g. empty kanban columns)
  try {
    const milestones = await niftyFetch('GET', `/milestones?project_id=${projectId}`);
    const items = milestones.items || (Array.isArray(milestones) ? milestones : []);
    for (const m of items) {
      try {
        const md = await niftyFetch('GET', `/tasks?milestone_id=${m.id}`);
        const mt = Array.isArray(md) ? md : (md.tasks || []);
        mt.forEach((t) => t.task_group && ids.add(t.task_group));
      } catch (_) {}
    }
  } catch (_) {}

  return [...ids];
}

async function findTaskGroupByName(projectId, name) {
  const groupIds = await getTaskGroupIds(projectId);
  const target = name.toLowerCase();
  for (const gid of groupIds) {
    try {
      const group = await niftyFetch('GET', `/taskgroups/${gid}`);
      if (group.name?.toLowerCase().includes(target)) return gid;
    } catch (_) {
      // skip
    }
  }
  return null;
}

async function listTicketsInColumn(columnMatcher, ticketStatus) {
  const tickets = [];
  const errors = [];

  for (const [projectId, clientSlug] of Object.entries(PROJECT_MAP)) {
    let allTasks = [];
    try {
      const data = await niftyFetch('GET', `/tasks?project_id=${projectId}&limit=100`);
      allTasks = Array.isArray(data) ? data : (data.tasks || []);
    } catch (err) {
      errors.push({ project: clientSlug, stage: 'fetch_tasks', error: err.message });
      continue;
    }

    const groupIds = [...new Set(allTasks.map((t) => t.task_group).filter(Boolean))];
    let matchedGroupId = null;
    for (const gid of groupIds) {
      try {
        const group = await niftyFetch('GET', `/taskgroups/${gid}`);
        if (columnMatcher(group.name)) {
          matchedGroupId = gid;
          break;
        }
      } catch (err) {
        errors.push({ project: clientSlug, stage: 'fetch_group', group_id: gid, error: err.message });
        continue;
      }
    }

    if (!matchedGroupId) continue;

    const matched = allTasks.filter((t) => t.task_group === matchedGroupId && !t.completed && !t.archived);
    for (const task of matched) {
      tickets.push({
        task_id: task.id,
        title: task.name,
        description: task.description || '',
        client_slug: clientSlug,
        project_id: projectId,
        task_url: `https://app.niftypm.com/projects/${projectId}/tasks/${task.id}`,
        created_at: task.created_at,
        ticket_status: ticketStatus,
      });
    }
  }

  return { tickets, errors };
}

export async function listReadyForQATickets() {
  return listTicketsInColumn((name) => name?.toLowerCase().includes('ready for qa'), 'Ready for QA');
}

export async function listQAStatusTickets() {
  // Exact match: "QA" only — not "QA Complete", "QA N/A", "Ready for QA"
  return listTicketsInColumn((name) => name?.trim().toLowerCase() === 'qa', 'QA');
}

export async function listAllQATickets() {
  const [ready, inQA] = await Promise.all([listReadyForQATickets(), listQAStatusTickets()]);
  return {
    tickets: [...ready.tickets, ...inQA.tickets],
    errors: [...ready.errors, ...inQA.errors],
  };
}

export async function postComment(taskId, text) {
  const tagged = [...text.matchAll(/<@([^>]+)>/g)].map((m) => m[1]);
  const body = { task_id: taskId, type: 'text', text };
  if (tagged.length) body.tagged = tagged;
  const data = await niftyFetch('POST', '/messages', body);
  return { comment_id: data.id, task_id: taskId };
}

export async function updateTaskStatus(taskId, projectId, statusName) {
  const groupId = await findTaskGroupByName(projectId, statusName);
  if (!groupId) throw new Error(`Task group "${statusName}" not found in project ${projectId}`);
  await niftyFetch('PUT', `/tasks/${taskId}`, { task_group_id: groupId });
  return { task_id: taskId, status: statusName, task_group_id: groupId };
}

async function getProjectMembers(projectId) {
  try {
    const data = await niftyFetch('GET', `/members?project_id=${projectId}`);
    return Array.isArray(data) ? data : (data.members || data.data || []);
  } catch (_) {
    return [];
  }
}

export async function createTask(clientSlug, title, description) {
  const projectId = SLUG_TO_PROJECT[clientSlug];
  if (!projectId) throw new Error(`Unknown client_slug: ${clientSlug}`);

  // Column naming varies by project: "Ready for Dev", "In Dev", "Dev", etc.
  // Fallback IDs cover empty columns (no tasks → invisible to task-based lookup).
  const KNOWN_DEV_GROUP_IDS = {
    '4m35tboROc': '67GZiMqmapuDP', // helix: "Ready for Dev"
  };
  let groupId = await findTaskGroupByName(projectId, 'ready for dev');
  if (!groupId) groupId = await findTaskGroupByName(projectId, 'in dev');
  if (!groupId) groupId = await findTaskGroupByName(projectId, 'dev');
  if (!groupId) groupId = KNOWN_DEV_GROUP_IDS[projectId] ?? null;
  if (!groupId) throw new Error(`Dev column not found in project for ${clientSlug} — checked "Ready for Dev", "In Dev", "Dev"`);

  const data = await niftyFetch('POST', '/tasks', {
    project_id: projectId,
    task_group_id: groupId,
    name: title,
    description,
  });

  const taskId = data.id;

  // Assign to Pol Riba and post a review comment
  try {
    const members = await getProjectMembers(projectId);
    const pol = members.find((m) => m.name?.toLowerCase().includes('pol'));
    if (pol?.id) {
      await niftyFetch('PUT', `/tasks/${taskId}`, { assignees: [pol.id] });
    }
  } catch (_) {
    // Assignment failed — task is still created, skip silently
  }

  try {
    await niftyFetch('POST', '/messages', { task_id: taskId, type: 'text', text: '<@4XS6KjAZINSJ_> please review', tagged: ['4XS6KjAZINSJ_'] });
  } catch (_) {
    // Comment failed — skip silently
  }

  return {
    task_id: taskId,
    task_url: `https://app.niftypm.com/projects/${projectId}/tasks/${taskId}`,
    project_id: projectId,
  };
}
