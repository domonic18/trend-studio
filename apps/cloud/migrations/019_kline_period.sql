-- K 线显示口径与课程内容一致：案例股声明周期（日线/周线）。
-- 幂等：列不存在才加，check 约束可重复设置。

ALTER TABLE section_case_stocks ADD COLUMN IF NOT EXISTS period text NOT NULL DEFAULT '1d';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'section_case_stocks_period_check'
  ) THEN
    ALTER TABLE section_case_stocks
      ADD CONSTRAINT section_case_stocks_period_check CHECK (period = ANY (ARRAY['1d'::text, '1w'::text]));
  END IF;
END $$;
