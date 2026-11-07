import { createPool } from './db.js'
import { runMigrations } from './migrate.js'

// 独立迁移入口：发布流程里作为一次性容器执行（compose run --rm migrate），
// 与应用进程解耦——迁移失败即中止发布，旧版本继续服务。
// 只依赖数据库连接，不走 loadConfig：迁移不该被媒体签名密钥之类无关配置挡住。
const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  console.error('DATABASE_URL 必填')
  process.exit(1)
}

const pool = createPool(databaseUrl)
try {
  const ran = await runMigrations(pool)
  console.log(ran.length === 0 ? 'migrations up to date' : `applied: ${ran.join(', ')}`)
} catch (error) {
  console.error(error)
  await pool.end().catch(() => undefined)
  process.exit(1)
}
await pool.end()
