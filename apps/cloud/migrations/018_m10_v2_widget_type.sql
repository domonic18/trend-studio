-- M10 v2 批次：widget 类型白名单补 bar-replay-decision。
-- 幂等：先删后加（PostgreSQL 不直接支持 ALTER CHECK）。

ALTER TABLE widget_specs DROP CONSTRAINT IF EXISTS widget_specs_type_check;
ALTER TABLE widget_specs ADD CONSTRAINT widget_specs_type_check
  CHECK (type = ANY (ARRAY[
    'kline-annotator'::text,
    'pattern-quiz'::text,
    'step-reveal'::text,
    'calc-trainer'::text,
    'mcq-quiz'::text,
    'flashcards'::text,
    'checklist'::text,
    'timeline-explorer'::text,
    'bar-replay-decision'::text
  ]));
