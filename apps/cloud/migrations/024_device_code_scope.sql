-- 设备码授权加 scope：教员端（dsh-plugin-trend-producer）走 console 会话而非设备令牌。
-- 学员流程语义不变（默认 'student'）；幂等：仅加列，不回填历史行（默认值即覆盖）。

ALTER TABLE device_codes ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'student';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'device_codes_scope_check'
  ) THEN
    ALTER TABLE device_codes ADD CONSTRAINT device_codes_scope_check
      CHECK (scope = ANY (ARRAY['student'::text, 'console'::text]));
  END IF;
END $$;
