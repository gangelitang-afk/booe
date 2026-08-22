// ============================================================
// booe.xyz 全站入口 —— Workers Builds 高级模式
// - /api/guestbook : 留言板 API（D1 数据库）
// - 其他所有请求   : 交给静态资产（env.ASSETS）
// ============================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ---- 留言板 API ----
    if (url.pathname === '/api/guestbook') {
      return handleGuestbook(request, env);
    }

    // ---- 其余请求：静态资产 ----
    return env.ASSETS.fetch(request);
  }
};

// ================= 留言板 =================
async function handleGuestbook(request, env) {
  // 如果 D1 还没绑定，返回友好提示
  if (!env.DB) {
    return Response.json(
      { ok: false, error: '数据库未连接' },
      { status: 500 }
    );
  }

  // GET：读取留言列表
  if (request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, name, content, created_at FROM messages ORDER BY created_at DESC LIMIT 50'
    ).all();
    return Response.json({ ok: true, messages: results });
  }

  // POST：提交留言（30 秒限流）
  if (request.method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    const last = await env.DB.prepare(
      'SELECT created_at FROM messages WHERE ip = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(ip).first();

    if (last) {
      const lastTime = new Date(last.created_at).getTime();
      if (Date.now() - lastTime < 30 * 1000) {
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

  return Response.json({ ok: false, error: '不支持的方法' }, { status: 405 });
}
