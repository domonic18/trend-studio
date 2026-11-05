import type { LogLevel } from './config.js'

const LEVEL_WEIGHT = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 } as const satisfies Record<LogLevel, number>

export interface HostLogger {
  error(...args: unknown[]): void
  warn(...args: unknown[]): void
  info(...args: unknown[]): void
  debug(...args: unknown[]): void
}

/** 按 logLevel 过滤 Host 日志；云端文本一律不直接进日志（见 AGENTS.md 硬约束 7）。 */
export function createHostLogger(base: HostLogger, level: LogLevel): HostLogger {
  const threshold = LEVEL_WEIGHT[level]
  const wrap = (weight: number, emit: (...args: unknown[]) => void) =>
    (...args: unknown[]): void => {
      if (weight <= threshold) emit(...args)
    }
  return {
    error: wrap(LEVEL_WEIGHT.error, (...args) => base.error(...args)),
    warn: wrap(LEVEL_WEIGHT.warn, (...args) => base.warn(...args)),
    info: wrap(LEVEL_WEIGHT.info, (...args) => base.info(...args)),
    debug: wrap(LEVEL_WEIGHT.debug, (...args) => base.debug(...args)),
  }
}
