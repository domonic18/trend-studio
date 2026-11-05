# trend

趋势交易课程平台 monorepo（pnpm workspaces + Turborepo）。

## 目录

- `apps/cloud` — trend-coach-cloud：后端 Fastify + PG，前端 web/admin（编辑部）与 web/portal（学员门户预渲染）
- `apps/producer` — dsh-plugin-trend-producer：课程生产 Agent 编排插件（dsh）
- `apps/coach` — dsh-plugin-trend-coach：课程伴学插件（dsh）
- `apps/*/docs` — 各应用架构与需求文档（含 monorepo 迁移方案）

## 环境要求

- Node >= 22，pnpm 9（仓库以 `packageManager` 字段锁定）
- cloud 测试需本地 Postgres 并设置 `TEST_DATABASE_URL`（测试会清空该库，守卫拦截与 `DATABASE_URL` 同库）

## 常用命令

```bash
pnpm install        # 安装全部 workspace
pnpm check          # 全部类型检查
pnpm build          # 全部构建（turbo 按依赖拓扑）
pnpm test           # 全部测试（cloud 需 TEST_DATABASE_URL）

# 单应用
pnpm --filter trend-coach-cloud test
pnpm --filter dsh-plugin-trend-producer check
```

## 依赖纪律

- `apps/*` 之间禁止互相 import；共享代码先落 `packages/*`（契约收敛见迁移方案 M3a）
- zod 全仓锁定 4.4.3（根 `pnpm.overrides`），避免 dsh 插件生态双实例类型冲突
- dsh 插件包名不可改名（插件 ID 依赖 package.json name）
