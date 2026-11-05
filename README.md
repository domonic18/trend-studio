# trend

趋势交易课程平台 monorepo（pnpm workspaces + Turborepo）。

## 目录

- `apps/cloud` — trend-coach-cloud：后端 Fastify + PG，前端 web/admin（编辑部）与 web/portal（学员门户预渲染）
- `apps/producer` — dsh-plugin-trend-producer：课程生产 Agent 编排插件（dsh）
- `apps/coach` — dsh-plugin-trend-coach：课程伴学插件（dsh）
- `packages/contracts` — @trend/contracts：跨端契约单一真相源（zod-first：生产 admin API schema、教材 DSL 解析与校验、ID 形状、个股锚映射）；openapi.yaml 保留为人读文档，由 cloud 契约测试做路由级双向锚定
- `packages/test-fixtures` — @trend/test-fixtures：golden 判定样本（合法全节 + 缺引用/跨节引用/错误版本/非法媒体反例；审批后修改样本随 M3b 审批绑定落地）
- `apps/*/docs` — 各应用架构与需求文档（含 monorepo 迁移方案）

各应用的边界、职责与硬约束见 `apps/*/AGENTS.md` 与 `apps/*/README.md`。

## 环境要求

- Node >= 22，pnpm 9（仓库以 `packageManager` 字段锁定）
- cloud 测试需本地 Postgres 并设置 `TEST_DATABASE_URL`（测试会清空该库，守卫拦截与 `DATABASE_URL` 同库）
- 本地 DB 惯例：一次性容器 `trend-cloud-db-5434`（pgvector/pgvector:pg17，`127.0.0.1:5434→5432`，bind mount `apps/cloud/workspace/postgres`；宿主 5432 被 agent-sims 占用）

## 快速开始

```bash
pnpm install        # 安装全部 workspace
pnpm check          # 全部类型检查
pnpm build          # 全部构建（turbo 按依赖拓扑）
pnpm test           # 全部测试（cloud 需 TEST_DATABASE_URL）

# cloud 测试（两个 URL 必须指向不同库；测试库会被清空）
TEST_DATABASE_URL=postgres://trend_coach:trend_coach@127.0.0.1:5434/trend_coach_test \
DATABASE_URL=postgres://trend_coach:trend_coach@127.0.0.1:5434/trend_coach \
pnpm --filter trend-coach-cloud test

# cloud 开发（详细命令见 apps/cloud/README.md）
pnpm --filter trend-coach-cloud dev        # 127.0.0.1:3939

# producer 发布 tarball（staging 内嵌 @trend/contracts，产物 apps/producer/*.tgz）
pnpm --filter dsh-plugin-trend-producer pack
```

行为基线（改 `packages/contracts` 前后必须全绿）：contracts 8 / fixtures 7 / producer 40 / coach 111 / cloud 181（180 pass + 1 skip）。

## 依赖纪律

- `apps/*` 之间禁止互相 import；`packages/*` 禁止依赖 `apps/*`；跨端共享的契约/样本一律落 packages（apps 内只留绑定自家错误形状的适配壳）
- 契约字段与 DSL 校验消息/错误码是 wire 契约的一部分：改 `@trend/contracts` 前先跑三端测试
- zod 全仓锁定 4.4.3（根 `pnpm.overrides`），避免 dsh 插件生态双实例类型冲突
- dsh 插件包名不可改名（插件 ID 依赖 package.json name）；发布 tarball 用 `pnpm --filter dsh-plugin-trend-producer pack`（staging 脚本内嵌 @trend/contracts，产物在 apps/producer/*.tgz，已 gitignore）

## 契约真相源分层

1. 人读契约：`apps/cloud/docs/` 三份文档（需求 → 架构 → 对接清单），接口字段与错误码冲突时以此为准
2. 机器真相：`packages/contracts`（zod），与云端文档同批变更，三端行为基线测试把关
3. 插件仓（producer/coach）只写消费方口径：渲染策略、编排、Skill 工艺
