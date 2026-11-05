-- M10 呈现层：diagram SVG 候选放宽 + 片段卡 asset 时间窗播放会话。

-- diagram 候选：rel_path 允许 .svg；矢量无固有像素尺寸，位图下限仅约束 jpg/png。
ALTER TABLE figure_candidates DROP CONSTRAINT IF EXISTS figure_candidates_rel_path_check;
ALTER TABLE figure_candidates ADD CONSTRAINT figure_candidates_rel_path_check
  CHECK (rel_path ~ '^fig_[A-Za-z0-9._-]+/cand_[A-Za-z0-9._-]+\.(jpg|png|svg)$');
ALTER TABLE figure_candidates DROP CONSTRAINT IF EXISTS figure_candidates_width_check;
ALTER TABLE figure_candidates DROP CONSTRAINT IF EXISTS figure_candidates_height_check;
ALTER TABLE figure_candidates ADD CONSTRAINT figure_candidates_pixel_size_check
  CHECK (rel_path ~ '\.svg$' OR (width >= 800 AND height >= 800));

-- 片段卡 HLS 时间窗直放：会话不再强制绑定学员 segment，可按 asset + 窗口签发（admin 预览通道）。
ALTER TABLE playback_sessions ALTER COLUMN segment_id DROP NOT NULL;
ALTER TABLE playback_sessions ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE playback_sessions ADD COLUMN asset_id text REFERENCES media_assets (asset_id) ON DELETE CASCADE;
ALTER TABLE playback_sessions ADD COLUMN window_from_sec integer CHECK (window_from_sec IS NULL OR window_from_sec >= 0);
ALTER TABLE playback_sessions ADD COLUMN window_to_sec integer CHECK (window_to_sec IS NULL OR window_to_sec > 0);
ALTER TABLE playback_sessions DROP CONSTRAINT IF EXISTS playback_sessions_scope_check;
ALTER TABLE playback_sessions ADD CONSTRAINT playback_sessions_scope_check
  CHECK ((segment_id IS NOT NULL AND device_id IS NOT NULL) OR asset_id IS NOT NULL);
ALTER TABLE playback_sessions ADD CONSTRAINT playback_sessions_window_check
  CHECK (window_from_sec IS NULL OR window_to_sec IS NULL OR window_to_sec > window_from_sec);
CREATE INDEX IF NOT EXISTS playback_sessions_asset_idx ON playback_sessions (asset_id, expires_at);
