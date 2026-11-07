-- 追加素材决策（场景 B）：人选择 A/B/C 后落库，并据此重置受影响节的九步状态。
CREATE TABLE IF NOT EXISTS production_material_choices (
  choice_id text PRIMARY KEY CHECK (choice_id ~ '^pmc_[0-9a-f]{16}$'),
  course_id text NOT NULL REFERENCES courses (course_id) ON DELETE CASCADE,
  asset_id text NOT NULL REFERENCES media_assets (asset_id) ON DELETE CASCADE,
  section_id text REFERENCES sections (section_id) ON DELETE CASCADE,
  choice text NOT NULL CHECK (choice IN ('A', 'B', 'C')),
  affected_section_ids text[] NOT NULL DEFAULT '{}'::text[],
  note text CHECK (note IS NULL OR char_length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_material_choices_course_idx
  ON production_material_choices (course_id, created_at DESC);
