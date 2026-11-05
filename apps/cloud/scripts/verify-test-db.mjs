// 守卫：TEST_DATABASE_URL 与 DATABASE_URL 指向同一库时拒绝跑测试。
// 契约/迁移测试会重放迁移并清空目标库——指向开发库会直接抹掉全部数据。
const dbName = (raw) => {
  try {
    return new URL(raw).pathname.replace(/^\//, '')
  } catch {
    return ''
  }
}

const testUrl = process.env.TEST_DATABASE_URL ?? ''
const devUrl = process.env.DATABASE_URL ?? ''

if (testUrl === '') {
  console.error('拒绝运行：未设置 TEST_DATABASE_URL')
  process.exit(1)
}

if (devUrl !== '' && dbName(testUrl) === dbName(devUrl)) {
  console.error(`拒绝运行：TEST_DATABASE_URL 与 DATABASE_URL 指向同一数据库 "${dbName(testUrl)}"（测试会清空该库）`)
  process.exit(1)
}
