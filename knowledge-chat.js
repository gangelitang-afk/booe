const encoder = new TextEncoder();
const sessionSeconds = 60 * 60;
const cookieName = '__Host-booe-kb';

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function error(message, status) {
  return json({ error: message }, status);
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function sign(key, text) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text)));
}

function sessionPayload(expiry, env) {
  return `booe-knowledge:${expiry}:${env.KNOWLEDGE_PASSWORD}`;
}

async function unlocked(request, key, env) {
  const cookie = request.headers.get('Cookie')?.split(';').map(value => value.trim())
    .find(value => value.startsWith(`${cookieName}=`));
  const match = cookie?.slice(cookieName.length + 1).match(/^(\d{10})\.([A-Za-z0-9+/]{43}=)$/);
  if (!match || Number(match[1]) <= Date.now() / 1000) return false;
  const signature = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(sessionPayload(match[1], env)));
}

async function readInput(request) {
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json' || !request.body) throw Error('Invalid request');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return JSON.parse(text + decoder.decode());
    size += value.byteLength;
    if (size > 8192) {
      await reader.cancel();
      throw Error('Request exceeds the size limit');
    }
    text += decoder.decode(value, { stream: true });
  }
}

async function askWeKnora(query, env) {
  const base = new URL(env.WEKNORA_ORIGIN);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw Error('Invalid WeKnora origin');
  }
  const headers = { 'Content-Type': 'application/json', 'X-API-Key': env.WEKNORA_API_KEY };
  if (env.WEKNORA_ACCESS_ID && env.WEKNORA_ACCESS_SECRET) {
    headers['CF-Access-Client-Id'] = env.WEKNORA_ACCESS_ID;
    headers['CF-Access-Client-Secret'] = env.WEKNORA_ACCESS_SECRET;
  }
  const signal = AbortSignal.timeout(60_000);
  const post = (path, input) => fetch(new URL(path, base), {
    method: 'POST', headers, signal, redirect: 'error', body: JSON.stringify(input)
  });
  const created = await post('/api/v1/sessions', { title: '数字基地 · 知识库问答' });
  if (!created.ok) throw Error('Session creation failed');
  const session = (await created.json()).data?.id;
  if (typeof session !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(session)) throw Error('Invalid session');
  const response = await post(`/api/v1/knowledge-chat/${session}`, {
    query, knowledge_base_ids: [env.WEKNORA_KB_ID], web_search_enabled: false
  });
  if (!response.ok || !response.headers.get('Content-Type')?.includes('text/event-stream') || !response.body) {
    throw Error('Knowledge chat failed');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  const sources = new Set();
  let complete = false;
  try {
    while (!complete) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 1_000_000) throw Error('Oversized event');
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop();
      for (const event of events) {
        const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        if (data === '[DONE]') { complete = true; break; }
        const item = JSON.parse(data);
        if (item.response_type === 'error') throw Error('Knowledge chat returned an error');
        if (item.response_type === 'answer' && typeof item.content === 'string') answer += item.content;
        if (answer.length > 100_000) throw Error('Oversized answer');
        if (item.response_type === 'references') {
          const references = item.knowledge_references ?? item.references ?? item.data?.references;
          if (Array.isArray(references)) {
            for (const ref of references.slice(0, 30)) {
              const name = ref.knowledge_title ?? ref.knowledge_filename ?? ref.file_name;
              if (typeof name === 'string' && name.trim()) sources.add(name.trim().slice(0, 250));
            }
          }
        }
        if (item.response_type === 'complete' || (item.response_type === 'answer' && item.done)) complete = true;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!complete || !answer.trim()) throw Error('No complete answer');
  return { answer, sources: [...sources].slice(0, 12) };
}

export async function handleKnowledgeChat(request, env) {
  if (request.method !== 'POST') return error('请使用页面提交请求。', 405);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return error('请从数字基地页面提交。', 403);
  if (!env.KNOWLEDGE_PASSWORD || !env.KNOWLEDGE_SESSION_SECRET || !env.WEKNORA_ORIGIN ||
      !env.WEKNORA_API_KEY || !env.WEKNORA_KB_ID || !env.KNOWLEDGE_LIMIT) {
    return error('知识库连接尚未配置。', 503);
  }

  const path = new URL(request.url).pathname;
  if (path !== '/api/knowledge/unlock' && path !== '/api/knowledge/ask') return error('页面不存在。', 404);
  const key = await hmacKey(env.KNOWLEDGE_SESSION_SECRET);
  const isUnlock = path.endsWith('/unlock');
  if (!isUnlock && !await unlocked(request, key, env)) return error('请先输入访问密码。', 401);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const limit = await env.KNOWLEDGE_LIMIT.limit({ key: `${path}:${ip}` });
  if (!limit.success) return error('操作过于频繁，请稍后再试。', 429);

  let input;
  try { input = await readInput(request); } catch { return error('提交的内容格式不正确。', 400); }
  if (isUnlock) {
    const password = input?.password;
    if (typeof password !== 'string' || password.length > 256 ||
        !await crypto.subtle.verify('HMAC', key, await sign(key, `password:${env.KNOWLEDGE_PASSWORD}`), encoder.encode(`password:${password}`))) {
      return error('访问密码不正确。', 401);
    }
    const expiry = Math.floor(Date.now() / 1000) + sessionSeconds;
    const signature = btoa(String.fromCharCode(...await sign(key, sessionPayload(expiry, env))));
    const cookie = `${cookieName}=${expiry}.${signature}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${sessionSeconds}`;
    return json({ ok: true }, 200, { 'Set-Cookie': cookie });
  }

  const query = typeof input?.query === 'string' ? input.query.trim() : '';
  if (!query || query.length > 1500) return error('请输入 1 至 1500 字的问题。', 400);
  try {
    return json(await askWeKnora(query, env));
  } catch {
    return error('暂时无法从知识库取得回答，请稍后再试。', 502);
  }
}
