/** 装机向导的交互提问：普通文本 + 遮蔽输入的密码。 */
import { createInterface } from 'node:readline/promises'

const BACKSPACE = String.fromCharCode(8)
const ETX = 3
const EOT = 4
const DEL = 127

/** 提问；回车取默认值。非交互环境（无 TTY）返回默认值。 */
export async function ask(question, options = {}) {
  if (!process.stdin.isTTY) return options.defaultValue ?? ''
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const suffix = options.defaultValue === undefined || options.defaultValue === '' ? '' : ` [${options.defaultValue}]`
    const answer = (await rl.question(`${question}${suffix}: `)).trim()
    return answer === '' ? (options.defaultValue ?? '') : answer
  } finally {
    rl.close()
  }
}

/** 密码提问：逐字符遮蔽，不回显原文。 */
export function askSecret(question) {
  if (!process.stdin.isTTY) return Promise.resolve('')
  return new Promise((resolve) => {
    const stdin = process.stdin
    const wasRaw = stdin.isRaw ?? false
    process.stdout.write(question)
    stdin.setRawMode?.(true)
    stdin.resume()
    let value = ''
    const finish = () => {
      stdin.off('data', onData)
      stdin.setRawMode?.(wasRaw)
      stdin.pause()
      process.stdout.write('\n')
      resolve(value)
    }
    const onData = (chunk) => {
      const text = chunk.toString('utf8')
      for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i)
        if (code === 10 || code === 13 || code === EOT) {
          finish()
          return
        }
        if (code === ETX) {
          process.stdout.write('\n')
          process.exit(130)
        }
        if (code === DEL || code === 8) {
          value = value.slice(0, -1)
          process.stdout.write(`${BACKSPACE} ${BACKSPACE}`)
          continue
        }
        value += text[i]
        process.stdout.write('*')
      }
    }
    stdin.on('data', onData)
  })
}

/** 确认题（yes/no），默认否。 */
export async function confirm(question, defaultValue = false) {
  const suffix = defaultValue ? ' [Y/n]' : ' [y/N]'
  const answer = (await ask(`${question}${suffix}`)).toLowerCase()
  if (answer === '') return defaultValue
  return answer === 'y' || answer === 'yes'
}
