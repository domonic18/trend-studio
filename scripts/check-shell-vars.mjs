/**
 * 静态检查：shell 脚本里「无花括号变量紧跟非 ASCII 字符」。
 *
 * bash 在 UTF-8 locale 下会把变量名后面紧跟的多字节字符吃进变量名：
 * `echo "dsh --profile $PROFILE（没预装…"` 会被当成引用变量 `PROFILE（`，
 * 脚本在 `set -u` 下以「未绑定的变量」中断——装到最后一步才炸，教员只看到
 * 一句莫名其妙的 bash 报错。
 *
 * 花括号写法 `${PROFILE}` 明确闭合变量名，安全。全仓只允许这一种。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'workspace'])

/** `$NAME` 后面紧跟一个非 ASCII 字符——变量名会被 bash 吃进那个字符。 */
const PATTERN = /\$([A-Za-z_][A-Za-z0-9_]*)([^\x00-\x7F])/g

function collectShellScripts(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) collectShellScripts(full, found)
    else if (entry.endsWith('.sh')) found.push(full)
  }
  return found
}

const problems = []
for (const file of collectShellScripts(repoRoot)) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    if (line.trimStart().startsWith('#')) return
    for (const match of line.matchAll(PATTERN)) {
      problems.push({
        file: path.relative(repoRoot, file),
        line: index + 1,
        name: match[1],
        snippet: line.trim(),
      })
    }
  })
}

if (problems.length > 0) {
  for (const problem of problems) {
    process.stderr.write(`${problem.file}:${problem.line} 变量 $${problem.name} 紧跟非 ASCII 字符——写成 \${${problem.name}}\n  ${problem.snippet}\n`)
  }
  process.stderr.write(`\nshell 变量名被 bash 吃进全角字符，脚本会以「未绑定的变量」中断。共 ${problems.length} 处。\n`)
  process.exit(1)
}

process.stdout.write('shell 变量写法检查通过：没有无花括号变量紧跟非 ASCII 字符。\n')
