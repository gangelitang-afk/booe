-- 留言板建表 SQL —— 在 Cloudflare D1 控制台执行
-- 数据库名建议: booe-db

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '匿名',
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_ip ON messages(ip);
