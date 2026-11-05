-- M9 语料级生产：节（sections）、多模态理解产物（source_units）、概念图谱、
-- 交互课件 spec 与生产溯源；生产 Agent 循环在外部 dsh 生产插件，云端只存草稿与证明。

CREATE TABLE sections (
  section_id text PRIMARY KEY CHECK (section_id ~ '^sec_[0-9a-f]{16}$'),
  course_id text NOT NULL,
  chapter_id text NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  position integer NOT NULL CHECK (position >= 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  summary text CHECK (summary IS NULL OR char_length(summary) <= 2000),
  source_asset_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_asset_ids) = 'array'),
  concept_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(concept_refs) = 'array'),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (course_id, chapter_id) REFERENCES chapters (course_id, chapter_id) ON DELETE CASCADE,
  UNIQUE (course_id, chapter_id, section_id),
  UNIQUE (course_id, section_id),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE INDEX sections_course_idx ON sections (course_id, chapter_id, position);

CREATE TABLE section_articles (
  section_id text PRIMARY KEY REFERENCES sections (section_id) ON DELETE CASCADE,
  markdown text NOT NULL CHECK (char_length(markdown) BETWEEN 1 AND 20000),
  citations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(citations) = 'array'),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE TABLE source_units (
  unit_id text PRIMARY KEY CHECK (unit_id ~ '^su_[0-9a-f]{16}$'),
  asset_id text NOT NULL REFERENCES media_assets (asset_id) ON DELETE CASCADE,
  transcript_id text REFERENCES media_transcripts (transcript_id) ON DELETE SET NULL,
  start_ms bigint NOT NULL CHECK (start_ms >= 0),
  end_ms bigint NOT NULL CHECK (end_ms > start_ms),
  transcript_text text NOT NULL CHECK (char_length(transcript_text) BETWEEN 1 AND 8000),
  visual jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(visual) = 'object'),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 2000),
  concept_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(concept_refs) = 'array'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  produced_by jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(produced_by) = 'object'),
  embedding halfvec(1024),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, start_ms)
);

CREATE INDEX source_units_asset_idx ON source_units (asset_id, start_ms);
CREATE INDEX source_units_summary_trgm_idx ON source_units USING gin (summary gin_trgm_ops);
CREATE INDEX source_units_embedding_idx ON source_units
  USING hnsw (embedding halfvec_cosine_ops);

CREATE TABLE concepts (
  concept_id text PRIMARY KEY CHECK (concept_id ~ '^cpt_[0-9a-f]{16}$'),
  course_id text NOT NULL REFERENCES courses (course_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(aliases) = 'array'),
  definition text CHECK (definition IS NULL OR char_length(definition) <= 2000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, name),
  UNIQUE (course_id, concept_id)
);

CREATE INDEX concepts_course_idx ON concepts (course_id, status);

CREATE TABLE concept_edges (
  edge_id text PRIMARY KEY CHECK (edge_id ~ '^ced_[0-9a-f]{16}$'),
  course_id text NOT NULL,
  from_concept_id text NOT NULL REFERENCES concepts (concept_id) ON DELETE CASCADE,
  to_concept_id text NOT NULL REFERENCES concepts (concept_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('prerequisite', 'related')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (course_id, from_concept_id) REFERENCES concepts (course_id, concept_id) ON DELETE CASCADE,
  FOREIGN KEY (course_id, to_concept_id) REFERENCES concepts (course_id, concept_id) ON DELETE CASCADE,
  UNIQUE (course_id, from_concept_id, to_concept_id, kind),
  CHECK (from_concept_id <> to_concept_id)
);

CREATE INDEX concept_edges_course_idx ON concept_edges (course_id, kind);

CREATE TABLE widget_specs (
  widget_id text PRIMARY KEY CHECK (widget_id ~ '^wgt_[0-9a-f]{16}$'),
  section_id text NOT NULL REFERENCES sections (section_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses (course_id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('kline-annotator', 'pattern-quiz', 'step-reveal',
                                     'calc-trainer', 'mcq-quiz', 'flashcards',
                                     'checklist', 'timeline-explorer')),
  spec_version integer NOT NULL DEFAULT 1 CHECK (spec_version >= 1),
  spec jsonb NOT NULL CHECK (jsonb_typeof(spec) = 'object'),
  assertions jsonb NOT NULL CHECK (jsonb_typeof(assertions) = 'object'),
  validation jsonb NOT NULL CHECK (jsonb_typeof(validation) = 'object'),
  citations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(citations) = 'array'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (course_id, section_id) REFERENCES sections (course_id, section_id) ON DELETE CASCADE
);

CREATE INDEX widget_specs_section_idx ON widget_specs (section_id, created_at);

-- 图示扩展：节级归属与程序化 diagram（spec 确定性出 SVG，标注文字不允许文生图代替）。
ALTER TABLE figures ADD COLUMN section_id text REFERENCES sections (section_id) ON DELETE CASCADE;
ALTER TABLE figures ADD COLUMN spec jsonb CHECK (spec IS NULL OR jsonb_typeof(spec) = 'object');
CREATE INDEX figures_section_idx ON figures (section_id);
ALTER TABLE figures DROP CONSTRAINT figures_kind_check;
ALTER TABLE figures ADD CONSTRAINT figures_kind_check
  CHECK (kind IN ('keyframe', 'generated', 'diagram'));

-- ingest 关键帧轨道阶段：转写之后、finalize 之前。
ALTER TABLE pipeline_jobs DROP CONSTRAINT pipeline_jobs_stage_check;
ALTER TABLE pipeline_jobs ADD CONSTRAINT pipeline_jobs_stage_check
  CHECK (stage IN ('queued', 'probe', 'transcode', 'transcribe', 'keyframes', 'structure',
                   'generate', 'figure_plan', 'figure_render', 'finalize', 'done'));

-- 生产溯源：生产插件自报模型调用入同一账本（token 为自报口径，按 source 区分）。
ALTER TABLE ai_runs DROP CONSTRAINT ai_runs_source_check;
ALTER TABLE ai_runs ADD CONSTRAINT ai_runs_source_check
  CHECK (source IN ('pipeline', 'admin', 'producer'));
ALTER TABLE ai_runs ADD COLUMN skill_versions jsonb
  CHECK (skill_versions IS NULL OR jsonb_typeof(skill_versions) = 'object');
