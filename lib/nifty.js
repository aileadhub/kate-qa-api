import { Redis } from '@upstash/redis';

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const NIFTY_API = 'https://openapi.niftypm.com/api/v2.0';
const NIFTY_TOKEN_URL = 'https://openapi.niftypm.com/api/v1.0/oauth/token';

const CLIENT_SLUG_MAP = [
  { keywords: ['potomac'], slug: 'potomac-movers' },
  { keywords: ['helix'], slug: 'helix' },
  { keywords: ['boxstar'], slug: 'boxstar' },
  { keywords: ['cali'], slug: 'cali-moving' },
  { keywords: ['ellis'], slug: 'ellis-moving' },
  { keywords: ['mac'], slug: 'macs-moving' },
  { keywords: ['riseup', 'rise up'], slug: 'riseup-moving' },
  { keywords: ['amp'], slug: 'amp-movers' },
];

function basicAuth() {
  const credentials = `${process.env.NIFTY_CLIENT_ID}:${process.env.NIFTY_CLIENT_SECRET}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

function resolveClientSlug(projectName) {
  const lower = projectName.toLowerCase();
  for (const { keywords, slug } of CLIENT_SLUG_MAP) {
    if (keywords.some((k) => lower.includes(k))) return slug;
  }
  return null;
}

export async function getAccessToken() {
  const cached = await kv.get('nifty_access_token');
  if (cached) return cached;
  return refreshAccessToken();
}

export async function refreshAccessToken() {
  const res = await fetch(NIFTY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      workspace_id: process.env.NIFTY_WORKSPACE_ID,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Nifty token request failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const ttl = (data.expires_in || 3600) - 60;
  await kv.set('nifty_access_token', data.access_token, { ex: ttl });
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

  // Token expired — refresh and retry once
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

export async function listReadyForQATickets() {
  const { projects } = await niftyFetch('GET', '/projects');
  const tickets = [];

  for (const project of projects) {
    const clientSlug = resolveClientSlug(project.name);
    if (!clientSlug) continue;

    let tasks = [];
    try {
      const data = await niftyFetch(
        'GET',
        `/tasks?project_id=${project.id}&status=${encodeURIComponent('Ready for QA')}`
      );
      tasks = data.tasks || [];
    } catch (_) {
      continue;
    }

    for (const task of tasks) {
      let readyForQASince = task.updated_at;
      try {
        const { activities } = await niftyFetch('GET', `/tasks/${task.id}/activities`);
        const match = (activities || [])
          .filter((a) => JSON.stringify(a).includes('Ready for QA'))
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
        if (match) readyForQASince = match.created_at;
      } catch (_) {
        // fall back to updated_at
      }

      tickets.push({
        task_id: task.id,
        title: task.name,
        description: task.description || '',
        client_slug: clientSlug,
        project_name: project.name,
        task_url: `https://app.niftypm.com/projects/${project.id}/tasks/${task.id}`,
        updated_at: task.updated_at,
        ready_for_qa_since: readyForQASince,
      });
    }
  }

  return tickets;
}

export async function postComment(taskId, body) {
  const data = await niftyFetch('POST', `/tasks/${taskId}/comments`, { body });
  return { comment_id: data.id, task_id: taskId };
}

export async function updateTaskStatus(taskId, status) {
  await niftyFetch('PUT', `/tasks/${taskId}`, { status });
  return { task_id: taskId, status };
}
