/**
 * 装机向导的命令行解析。
 *
 * 开关（--non-interactive）出现即真，**不能把后面的参数吃掉**——否则
 * `--non-interactive --model-api anthropic-messages` 里的模型协议会静默丢失，
 * 装出来的 profile 用着默认协议，装机自检却只报「模型不可达」。
 * 取值参数（--model-api anthropic-messages）吃下一个 argv。
 */

/** 不带值的开关。 */
const BOOLEAN_FLAGS = new Set(['non-interactive'])

export function parseArgs(argv, defaults = {}) {
  const options = { ...defaults }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const [flag, inline] = arg.slice(2).split('=', 2)
    if (BOOLEAN_FLAGS.has(flag)) {
      options.nonInteractive = true
      continue
    }
    const value = inline ?? argv[++i] ?? ''
    if (flag === 'profile') options.profile = value
    else options[flag] = value
  }
  return options
}
