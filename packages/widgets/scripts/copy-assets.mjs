import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** tsc 不搬运静态资源；样式表随包产物一起发布，供消费端按需引入。 */
const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function copyCss(name, jsName = null) {
  const source = join(root, 'src', `${name}.css`)
  const target = join(root, 'lib', `${name}.css`)
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target)
  const css = await readFile(source, 'utf8')
  // widgets 历史出口为 ./styles，其他用 name.styles 避免与 index.js 冲突
  const outBase = jsName ?? `${name}.styles`
  await writeFile(
    join(root, 'lib', `${outBase}.js`),
    `export const ${name}Css = ${JSON.stringify(css)}\n`,
    'utf8',
  )
  await writeFile(
    join(root, 'lib', `${outBase}.d.ts`),
    `export declare const ${name}Css: string\n`,
    'utf8',
  )
}

// widgets 保持历史文件名 styles.js（coach 通过 ./styles 引用）
await copyCss('widgets', 'styles')
await copyCss('course')
