import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** tsc 不搬运静态资源；样式表随包产物一起发布，供消费端按需引入。 */
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'src', 'widgets.css')
const target = join(root, 'lib', 'widgets.css')

await mkdir(dirname(target), { recursive: true })
await cp(source, target)
