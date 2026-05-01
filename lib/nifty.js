import { Redis } from '@upstash/redis';

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const NIFTY_API = 'https://openapi.niftypm.com/api/v1.0';
const NIFTY_TOKEN_URL = 'https://openapi.niftypm.com/oauth/token';

// From daria-os-crm/src/lib/nifty/project-map.ts
const PROJECT_MAP = {
  UcBgrt1c0BJhl: 'riseup-moving',
  fslejpJvVD57C: 'boxstar',
  Z7QKdCHVkc2m: 'amp-movers',
  '0tCS8B8WoLruD': 'potomac-movers',
  NlPuRYaeSjPh_: 'ellis-moving',
  RbNm9wOfG399Ts: 'cali-moving',
  '4m35tboROc': 'helix',
  TqezsE9nmG: 'macs-moving',
};

function basicAuth() {
  const credentials = `${process.env.NIFTY_CLIENT_ID}:${process.env.NIFTY_CLIENT_SECRET}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

export async function getAccessToken() {
  const token = await kv.get('nifty_access_token');
  if (!token) throw new Error('No Nifty access token — visit /api/nifty/oauth/start to authorize');
  return token;
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

  if (res.status === 401) {
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

async function findTaskGroupByName(projectId, name) {
  const data = await niftyFetch('GET', `/tasks?project_id=${projectId}`);
  const tasks = Array.isArray(data) ? data : (data.tasks || []);
  const groupIds = [...new Set(tasks.map((t) => t.task_group).filter(Boolean))];

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

export async function listReadyForQATickets() {
  const tickets = [];

  for (const [projectId, clientSlug] of Object.entries(PROJECT_MAP)) {
    let allTasks = [];
    try {
      const data = await niftyFetch('GET', `/tasks?project_id=${projectId}`);
      allTasks = Array.isArray(data) ? data : (data.tasks || []);
    } catch (_) {
      continue;
    }

    // Find the "Ready for QA" column ID for this project
    const groupIds = [...new Set(allTasks.map((t) => t.task_group).filter(Boolean))];
    let readyGroupId = null;
    for (const gid of groupIds) {
      try {
        const group = await niftyFetch('GET', `/taskgroups/${gid}`);
        if (group.name?.toLowerCase().includes('ready for qa')) {
          readyGroupId = gid;
          break;
        }
      } catch (_) {
        continue;
      }
    }

    if (!readyGroupId) continue;

    const readyTasks = allTasks.filter((t) => t.task_group === readyGroupId);
    for (const task of readyTasks) {
      tickets.push({
        task_id: task.id,
        title: task.name,
        description: task.description || '',
        client_slug: clientSlug,
        project_id: projectId,
        task_url: `https://app.niftypm.com/projects/${projectId}/tasks/${task.id}`,
        updated_at: task.updated_at,
      });
    }
  }

  return tickets;
}

export async function postComment(taskId, text) {
  const data = await niftyFetch('POST', '/messages', { task_id: taskId, text });
  return { comment_id: data.id, task_id: taskId };
}

export async function updateTaskStatus(taskId, projectId, statusName) {
  const groupId = await findTaskGroupByName(projectId, statusName);
  if (!groupId) throw new Error(`Task group "${statusName}" not found in project ${projectId}`);
  await niftyFetch('PUT', `/tasks/${taskId}`, { task_group: groupId });
  return { task_id: taskId, status: statusName, task_group_id: groupId };
}
