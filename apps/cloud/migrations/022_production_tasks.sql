-- 生产任务状态机：9 步生产顺序（案例股→行情同步→行情读回→图示→回放课件→正文→其余课件→评审→溯源）
-- 落库为「节 × 步骤」的任务行，供看板呈现进度与阻塞点；幂等：表与索引均 IF NOT EXISTS。

CREATE TABLE IF NOT EXISTS production_tasks (
  task_id text PRIMARY KEY CHECK (task_id ~ '^pt_[0-9a-f]{16}$'),
  course_id text NOT NULL,
  section_id text NOT NULL REFERENCES sections (section_id) ON DELETE CASCADE,
  step text NOT NULL CHECK (step = ANY (ARRAY[
    'case_stocks'::text, 'quotes_sync'::text, 'quotes_read'::text,
    'figures'::text, 'replay_widget'::text, 'article'::text,
    'widgets'::text, 'review'::text, 'provenance'::text
  ])),
  status text NOT NULL CHECK (status = ANY (ARRAY[
    'pending'::text, 'running'::text, 'done'::text, 'blocked'::text, 'failed'::text
  ])),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  note text CHECK (note IS NULL OR char_length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (course_id, section_id) REFERENCES sections (course_id, section_id) ON DELETE CASCADE,
  UNIQUE (course_id, section_id, step)
);

CREATE INDEX IF NOT EXISTS production_tasks_course_idx ON production_tasks (course_id, section_id);
