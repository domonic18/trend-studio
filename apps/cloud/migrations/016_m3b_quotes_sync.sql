-- M3b B5 行情层：quotes_sync 任务类型 + 腾讯前复权日K 不含成交额。

-- 行情同步留痕任务（同步执行不入队，只落一条 succeeded 记录）。
ALTER TABLE pipeline_jobs DROP CONSTRAINT IF EXISTS pipeline_jobs_kind_check;
ALTER TABLE pipeline_jobs ADD CONSTRAINT pipeline_jobs_kind_check
  CHECK (kind IN ('ingest', 'generate', 'illustrate', 'quotes_sync'));

-- 腾讯前复权日K 只有 OHLC 与成交量（手），无成交额；amount 允许为空表示「源不可得」。
ALTER TABLE course_stock_quotes ALTER COLUMN amount DROP NOT NULL;
