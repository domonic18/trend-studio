/**
 * 学员侧（catalog）契约：课程消费端下发的数据形状。
 *
 * v3 起与 admin 契约分开——admin 是管理面（写入 + 复检），catalog 是学员面（只读已发布内容）。
 */

import { z } from 'zod'

/** 行情条目：腾讯前复权日K 原始口径。 */
export const quotesItem = z.object({
  code: z.string().regex(/^[0-9]{6}$/),
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  /** 成交量，单位手（1 手 = 100 股）。 */
  volume: z.number().int().nonnegative(),
  /** 成交额（元）；腾讯前复权日K 不含成交额，为 null。 */
  amount: z.number().nullable(),
  /** 复权口径来源（tencent-qfq）。 */
  source: z.string().min(1).max(32),
}).strict()

export const quotesListOutput = z.object({
  /** 课程有已发布案例股但一行行情都没有 → 尚未同步，渲染层显示等待态。 */
  pending: z.boolean(),
  quotes: z.array(quotesItem),
}).strict()

export type QuotesItem = z.infer<typeof quotesItem>
export type QuotesListOutput = z.infer<typeof quotesListOutput>
