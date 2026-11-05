import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** tsc 不搬运静态资源；样式表随包产物一起发布，供消费端按需引入。 */
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'src', 'widgets.css')
const target = join(root, 'lib', 'widgets.css')

await mkdir(dirname(target), { recursive: true })
await cp(source, target)

// 无打包器的消费端（如 esbuild 打进单文件 bundle）拿不到样式表引用；
// 同时导出样式文本，消费端可在运行时注入 <style>。
const css = await readFile(source, 'utf8')
await writeFile(
  join(root, 'lib', 'styles.js'),
  `export const widgetsCss = ${JSON.stringify(css)}\n`,
  'utf8',
)
await writeFile(
  join(root, 'lib', 'styles.d.ts'),
  'export declare const widgetsCss: string\n',
  'utf8',
)
