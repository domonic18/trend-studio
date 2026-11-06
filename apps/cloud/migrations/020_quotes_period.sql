-- 行情缓存周期原生化（M10 K 线口径增量）：
-- 缓存不再只存日线，改为按周期存（1d 日线 / 1w 周线），唯一键含周期。
--
-- 为什么需要周线原生行：腾讯日K接口单次最多回溯约 641 根日线（约 2.6 年），
-- 聚合出的周线只有约 128 根，60 周 M60 在教学窗口内算不出来；而腾讯周K接口
-- 单次可回溯 640 根周线（约 12 年），周线 M60 与 2015/2019/2021 历史窗口都能覆盖。
--
-- 幂等：可重复执行；旧行按日线迁移（period 默认 '1d'）。

ALTER TABLE course_stock_quotes ADD COLUMN IF NOT EXISTS period text NOT NULL DEFAULT '1d';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_stock_quotes_period_check'
  ) THEN
    ALTER TABLE course_stock_quotes
      ADD CONSTRAINT course_stock_quotes_period_check CHECK (period IN ('1d', '1w'));
  END IF;
END $$;

-- 唯一键从 (code, trade_date) 扩到 (code, period, trade_date)：同一代号可同时存日线与周线。
ALTER TABLE course_stock_quotes DROP CONSTRAINT IF EXISTS course_stock_quotes_code_trade_date_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_stock_quotes_code_period_trade_date_key'
  ) THEN
    ALTER TABLE course_stock_quotes
      ADD CONSTRAINT course_stock_quotes_code_period_trade_date_key UNIQUE (code, period, trade_date);
  END IF;
END $$;

DROP INDEX IF EXISTS course_stock_quotes_code_idx;
CREATE INDEX IF NOT EXISTS course_stock_quotes_code_period_idx
  ON course_stock_quotes (code, period, trade_date DESC);
