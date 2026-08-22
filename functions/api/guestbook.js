// 留言板 API —— Cloudflare D1 + Pages Functions
// 路由：/api/guestbook
// GET  → 读取留言列表
// POST → 提交留言 {name, content}

// 防简单刷屏：同 IP 30 秒内限 1 条
const RATE_LIMIT_SECONDS = 30;

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const { results } = await env.DB.prepare(
      'SELECT id, name, content, created_at FROM messages ORDER BY created_at DESC LIMIT 50'
    ).all();
    return Response.json({ ok: true, messages: results });
  } catch (e) {
    return Response.json({ ok: false, error: '数据库读取失败' }, { status: 500 });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // 限流检查
  const last = await env.DB.prepare(
    'SELECT created_at FROM messages WHERE ip = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(ip).first();

  if (last) {
    const lastTime = new Date(last.created_at).getTime();
    if (Date.now() - lastTime < RATE_LIMIT_SECONDS * 1000) {
      return Response.json(
        { ok: false, error: '太快了，歇 30 秒再写' },
        { status: 429 }
      );
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: '格式不对' }, { status: 400 });
  }

  const name = String(body.name || '匿名').trim().slice(0, 20);
  const content = String(body.content || '').trim().slice(0, 500);
  if (!content) {
    return Response.json({ ok: false, error: '说点什么吧' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO messages (id, name, content, created_at, ip) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, name, content, created_at, ip).run();

  return Response.json({ ok: true, message: { id, name, content, created_at } });
}
