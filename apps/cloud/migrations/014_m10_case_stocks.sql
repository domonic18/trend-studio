-- M10 R2：节级案例股清单（架构 §5 / §6.6.3）；生产端抽取，云端复检后落库。
-- 代号双形态：正文锚用 sz|sh|bj 前缀，落库用 exchange + 6 位数字（§6.6.1）。

CREATE TABLE IF NOT EXISTS section_case_stocks (
  stock_ref_id text PRIMARY KEY CHECK (stock_ref_id ~ '^cst_[0-9a-f]{16}$'),
  section_id text NOT NULL REFERENCES sections (section_id) ON DELETE CASCADE,
  course_id text NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  exchange text NOT NULL CHECK (exchange IN ('SZSE', 'SSE', 'BSE')),
  code text NOT NULL CHECK (code ~ '^[0-9]{6}$'),
  window_start date NOT NULL,
  window_end date NOT NULL,
  events jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(events) = 'array'),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  position integer NOT NULL DEFAULT 1 CHECK (position >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section_id, code),
  CHECK (window_end >= window_start)
);

CREATE INDEX IF NOT EXISTS section_case_stocks_course_idx ON section_case_stocks (course_id, code);
