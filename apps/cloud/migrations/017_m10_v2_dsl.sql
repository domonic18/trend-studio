-- M10 v2：正文 DSL 版本（annotation / replay）。
-- 纯 v1 存量正文版本为 1，审批指纹不变。

ALTER TABLE section_articles ADD COLUMN IF NOT EXISTS dsl_version integer NOT NULL DEFAULT 1;
