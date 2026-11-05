-- M3b 治理与行情层：producer 角色、审批版本绑定、课程行情缓存。

-- producer 角色进入全集；旧约束名来自 003 的内联 CHECK（自动命名 users_role_check）。
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('student', 'operator', 'admin', 'producer'));

-- 审批版本绑定：digest 在审批签名时计算一次，发布时重算比对（不落库、不可变值只存这里）。
CREATE TABLE IF NOT EXISTS content_approvals (
  approval_id text PRIMARY KEY CHECK (approval_id ~ '^apr_[0-9a-f]{16}$'),
  course_id text NOT NULL REFERENCES courses (course_id) ON DELETE CASCADE,
  gate text NOT NULL CHECK (gate IN ('skeleton', 'final')),
  digest text NOT NULL,
  digest_sections jsonb NOT NULL,
  approved_by text NOT NULL REFERENCES users (user_id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, gate)
);

-- 课程行情缓存：腾讯前复权日K，(code, trade_date) 唯一幂等 upsert。
CREATE TABLE IF NOT EXISTS course_stock_quotes (
  code text NOT NULL CHECK (code ~ '^[0-9]{6}$'),
  trade_date date NOT NULL,
  open numeric NOT NULL CHECK (open >= 0),
  high numeric NOT NULL CHECK (high >= 0),
  low numeric NOT NULL CHECK (low >= 0),
  close numeric NOT NULL CHECK (close >= 0),
  volume bigint NOT NULL CHECK (volume >= 0),
  amount numeric NOT NULL CHECK (amount >= 0),
  source text NOT NULL DEFAULT 'tencent-qfq',
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, trade_date)
);

CREATE INDEX IF NOT EXISTS course_stock_quotes_code_idx ON course_stock_quotes (code, trade_date DESC);
