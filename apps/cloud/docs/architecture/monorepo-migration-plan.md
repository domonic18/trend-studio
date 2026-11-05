# Trend 三仓迁移 Monorepo 实施方案

版本：v1.0（2026-11-05）  
状态：已裁决，待执行  
适用范围：`trend-coach-cloud`、`dsh-plugin-trend-producer`、`dsh-plugin-trend-coach`

## 1. 决策与目标

将三个独立仓库一次性迁移为 Monorepo，统一代码、契约、文档、测试和外部协作入口。迁移采用“当前快照迁入 + 契约同步纠偏 + 全量验收 + 旧仓只读归档”，不做跨仓历史迁移，不保留新旧仓双向同步，不为迁移过程引入长期兼容层。

目标：

1. 一个仓库承载云端、生产插件、学员插件，外部协作者只有一个克隆、Issue、PR 和文档入口。
2. 契约、提供方、消费方和 fixtures 可在同一变更中修改并验证。
3. 三个产品保持独立构建、部署和发布，不因同仓变成单体应用。
4. 在迁移窗口内直接修复已确认的跨端契约缺口，避免先复制问题再二次返工。
5. 早期阶段以简单为先：不发布独立 npm 契约包，不建立 RC 流程和跨仓兼容矩阵。

非目标：

- 不合并三个产品的运行进程、数据库、鉴权域或部署边界。
- 不为了让代码同仓而允许应用之间任意引用内部实现。
- 不在迁移窗口重写与迁移无关的业务功能。
- 不删除旧仓历史，不在新旧仓同时继续开发。

## 2. 迁移基线与前提

实际迁入快照（2026-11-05 执行，旧仓已打 `pre-monorepo` 标签）：

| 原仓库 | 目标目录 | 基线提交 | 迁入调整 |
|---|---|---|---|
| `trend-coach-cloud` | `apps/cloud` | `384a44c`（= `83de68b` + 本方案 v1.1 与索引两笔 docs 提交） | 不迁 `.github/workflows/ci.yml`（monorepo 级 CI 重建）与 `package-lock.json`（pnpm 接管） |
| `dsh-plugin-trend-producer` | `apps/producer` | `e0255a6` | 不迁 `package-lock.json` |
| `dsh-plugin-trend-coach` | `apps/coach` | `dea79df` | 不迁 `.github/workflows/ci.yml` 与 `package-lock.json` |

迁入核验：三仓文件级 diff 仅上述有意移除项，其余逐文件一致。§2 前提「无存量 v2 学员与已发布课程」已于 M0 执行确认成立，学习契约直接切 v3。

前提：

- 当前由同一开发者维护，可设置明确停写窗口。
- 外部协作者可访问三个项目的代码；若未来需要按合作方隔离代码读取权限，应另行划分公开与私有仓库，CODEOWNERS 不能替代访问控制。
- 直接统一学习契约 v3 的前提是：没有必须继续服务的外部学员和必须原样保留的已发布课程。若存在存量数据，只增加一次性数据迁移或重生产步骤，不恢复 v2/v3 长期双轨。

## 3. 目标仓库结构

新仓工作名使用 `trend`，正式名称在创建仓库时确定：

```text
trend/
├─ apps/
│  ├─ cloud/                 # 云端服务、管理端、门户、数据库迁移
│  ├─ producer/              # dsh 生产插件与 Skill 工艺包
│  └─ coach/                 # dsh 学员插件
├─ packages/
│  ├─ contracts/             # 唯一契约源：Schema、OpenAPI、类型、错误码
│  ├─ test-fixtures/         # 三端共用正例、反例与端到端样例
│  └─ tooling/               # 共享 TypeScript、lint、测试配置
├─ docs/
│  ├─ requirements/          # 产品需求与验收
│  ├─ architecture/          # 总体及各应用架构、ADR
│  ├─ operations/            # 部署、监控、合规、恢复
│  └─ collaboration/         # 外部协作与发布规则
├─ .github/
│  ├─ workflows/
│  ├─ CODEOWNERS
│  ├─ ISSUE_TEMPLATE/
│  └─ PULL_REQUEST_TEMPLATE.md
├─ package.json
├─ pnpm-workspace.yaml
├─ turbo.json
└─ README.md
```

已有共享渲染实现确有消费方时再迁入 `packages/`；不为假想复用预先创建包。

### 3.1 依赖边界

允许：

```text
apps/cloud    ─┐
apps/producer ─┼─▶ packages/contracts
apps/coach    ─┘
三个应用（测试/开发依赖）─▶ packages/test-fixtures
所有 workspace ─▶ packages/tooling
```

禁止：

- `apps/*` 之间互相导入源码。
- producer/coach 引用 cloud 的数据库、路由、服务或内部配置。
- cloud 引用插件的 Agent、Skill、UI 或 dsh Host 代码。
- `packages/contracts` 反向依赖任何应用。
- 通过相对路径越过包边界，例如 `../../apps/cloud/src/...`。
- 三端继续维护同名 DTO、枚举或错误码的独立副本。

使用 ESLint/dependency-cruiser 等现有工具将边界固化为 CI 检查；只共享契约和确有共同演进需求的代码。

## 4. 总体迁移策略

采用一次明确切换，不在迁移期间维护三仓兼容：

1. 旧三仓停止新增开发并记录基线。
2. 将当前源码快照迁入新仓，保留原仓历史作为只读档案。
3. 在同一迁移周期统一 workspace、契约、文档和 CI。
4. 直接修复跨端阻断项，并统一学习契约 v3。
5. 全量测试和真实单节端到端验收通过后，新仓成为唯一开发入口。
6. 旧三仓标记只读并指向新仓，不做双向同步。

“一次性”指产品开发和仓库入口一次切换，不要求把所有修改塞进一个不可审查的提交。新仓内仍按下列提交序列保留可回退的小步历史：

1. `chore: import three projects into workspaces`
2. `build: unify workspace tooling and verification`
3. `refactor: consolidate shared contracts and fixtures`
4. `fix: close production and learning contract gaps`
5. `docs: consolidate product and collaboration guidance`
6. `ci: add full-stack verification and release checks`

## 5. 分阶段执行清单

### M0：停写、基线与回退点

- [ ] 确认三仓工作树干净，记录最终 HEAD。
- [ ] 在旧三仓打 `pre-monorepo` 标签；保留原 remote 与完整历史。
- [ ] 明确新仓名称、可见性、默认分支 `main` 和外部协作者权限。
- [ ] 盘点 `.env`、凭据、证书、`node_modules`、构建产物、日志、媒体、数据库与 `workspace/`，只迁入源码和应入库配置样例。
- [ ] 备份需要保留的本地数据；迁移窗口不清库、不执行不可逆数据删除。

退出条件：旧仓可独立恢复，新仓不包含密钥和运行期数据。

### M1：快照迁入与目录归位

- [ ] 创建 Monorepo 与 `apps/*` 目标目录。
- [ ] 按快照复制三仓源码、测试、公开配置和文档，不复制 `.git/`。
- [ ] 云端 `src/`、`web/`、`migrations/`、`openapi/`、`test/` 等先归位到 `apps/cloud/`。
- [ ] producer 的 `skills/`、`src/`、`test/`、`docs/research/` 完整保留在 `apps/producer/`。
- [ ] coach 的插件清单、源码、测试和文档归位到 `apps/coach/`。
- [ ] 根目录与各应用 `.gitignore` 合并，禁止提交依赖、构建产物、密钥、媒体和持久化数据。
- [ ] 修正仅因目录移动产生的构建路径，不做业务重构。

退出条件：三个项目在新位置能分别安装、类型检查、测试和构建；失败项有明确迁移原因，不以跳过测试收尾。

### M2：统一 workspace 与工程任务

- [ ] 使用 pnpm workspaces 管理 `apps/*` 和 `packages/*`。
- [ ] 使用 Turborepo 编排依赖、缓存和任务；当前规模下 CI 默认全量验证，不提前设计复杂 affected 规则。
- [ ] 统一 Node.js、pnpm、TypeScript 版本和基础配置；应用特有配置允许保留。
- [ ] 根目录提供统一命令：`check`、`test`、`build`、`test:e2e`。
- [ ] 每个应用保留独立命令，支持单独开发、构建与部署。
- [ ] 内部契约依赖使用 `workspace:*`，不经过 npm 发布。
- [ ] 删除三仓重复且纯样板的工程配置，但不强行合并语义不同的测试环境。

建议任务口径：

| 根命令 | 必须覆盖 |
|---|---|
| `pnpm check` | lint、类型检查、依赖边界、Schema/OpenAPI 一致性 |
| `pnpm test` | 三端单元测试、契约测试、fixtures 正反例 |
| `pnpm build` | cloud、producer、coach 各自正式构建 |
| `pnpm test:e2e` | 真实单节生产、审批、发布、学员消费闭环 |

退出条件：干净克隆后按根 README 可完成安装与全部验证，无仓外相对路径依赖。

### M3：契约单源与方案纠偏

- [ ] 建立 `packages/contracts`，收敛生产 API、学习契约、DSL、widgets、figures、案例股、provenance 和发布清单。
- [ ] 明确 JSON Schema/OpenAPI 与生成类型的唯一来源；三端只保留适配代码，不另建同义 DTO 真相源。
- [ ] 建立 `packages/test-fixtures`，至少覆盖完整合法节、缺引用、跨节引用、错误版本、非法媒体和审批后修改等反例。
- [ ] 移除 producer 与 coach 中已被契约包替代的手工重复定义。
- [ ] 保留运行时 `contractVersion`；Monorepo 只消除仓库同步成本，不取消内容兼容判断。

本阶段同时清零以下已确认阻断项：

| 项目 | 落地要求 | 验收证据 |
|---|---|---|
| 学习契约 v3 | cloud 生成、producer 生产、coach 读取同一 v3 fixtures | coach 实际渲染 DSL、图示、课件、案例股与媒体锚点 |
| source-unit 证据 | 提供按 unitId 读取转写、visual、keyframes 的受控契约 | 写作研究不依赖摘要猜测或绕过工具取数 |
| 段落级 citations | DSL/Markdown 表达块级引用，云端校验存在性与归属 | 事实段无引用、错误 unitId、跨节引用均被拒绝 |
| 图示写入顺序 | 先创建 figure 获取 ID，再写引用它的正文 | 含配图正文一次写入成功，未知 figure 仍失败 |
| 审批版本绑定 | 门禁①②绑定 revision/content hash，后续修改使审批失效 | 审批后修改正文或课件不能按原审批发布 |
| 发布硬门禁 | 发布验证当前 artifact 清单与批准版本一致 | 未审批、版本不一致、审批失效均不能发布 |
| 生产/发布分权 | producer 凭据不能调用 publish，发布由独立角色/scope 执行 | 服务端负向鉴权测试通过 |

若无存量兼容义务，直接移除 v2 运行双轨、旧 DTO 映射和临时降级代码；若存在存量课程，采用一次性迁移或重新生产，完成后删除旧轨。

退出条件：三端不再各自定义契约真相，所有阻断项有自动化负向测试。

### M4：文档、CI 与外部协作入口

- [ ] 合并三仓文档，保留一份现行产品需求、总体架构、开发计划和契约索引。
- [ ] 各应用文档只描述自身实现；字段和协议链接 `packages/contracts`，不复制完整定义。
- [ ] 研究稿、草案、已废弃文档明确分区，不能作为现行契约入口。
- [ ] 更新原 `AGENTS.md` 中的“云端仓是契约真相源”等迁移前规则，切换后指向 Monorepo 契约包。
- [ ] 根 README 提供一次克隆、安装、启动、测试和目录导航。
- [ ] 增加 CONTRIBUTING、安全披露、许可证、Issue/PR 模板和 CODEOWNERS；外部合作所需许可证由项目所有者确认后落库。
- [ ] Issue/PR 使用 `area:cloud`、`area:producer`、`area:coach`、`area:contracts` 标签保留责任边界。
- [ ] CI 在 PR 和 main 执行全量 `check/test/build`，契约变更必须执行 `test:e2e`。
- [ ] main 启用必须通过 CI 的分支保护；单人开发阶段不要求形式化多人审批。

退出条件：新协作者只阅读新仓即可理解如何开发、测试和提交变更，不再需要同时查阅三个仓库。

### M5：发布、切换与旧仓归档

- [ ] 云端独立构建和部署验证通过，数据库迁移先在备份或演练环境验证。
- [ ] producer/coach 插件从 Monorepo 构建产物安装到 dsh 验证，包名、插件 ID 与加载路径不意外变化。
- [ ] 保留产品独立发布；需要发版时使用 `cloud-v*`、`producer-v*`、`coach-v*` 标签，不要求三端同步上线。
- [ ] 发布产物继续记录 `contractVersion` 和内容 revision，禁止以“同仓”为由省略版本信息。
- [ ] 新仓验收完成后，旧三仓 README 指向新仓并设为只读归档。
- [ ] 旧仓不再接受提交，新仓不回写旧仓，避免出现两个活跃真相源。

退出条件：新仓是唯一活跃入口，旧仓仅用于历史查询和紧急恢复。

## 6. 最终验收清单

### 工程与边界

- [ ] 干净克隆后，统一安装、检查、测试、构建命令全部通过。
- [ ] 无 `../trend-coach-cloud`、`../dsh-plugin-trend-*` 等仓外路径依赖。
- [ ] 无应用间内部源码引用，无重复契约真相源。
- [ ] 三端可独立构建、部署和发布。
- [ ] 仓库中无 `.env`、密钥、证书、日志、媒体、数据库文件和运行期 `workspace/`。

### 真实端到端场景

使用一个真实总论卷节完成：

1. producer 拉取完整 source-unit 证据并生产含块级 citations 的 v3 教材。
2. 先创建 keyframe/diagram，再写入引用 figureId 的正文。
3. 课件、媒体锚点和案例股通过云端校验。
4. 门禁①②记录绑定当前内容 revision/hash。
5. 审批后修改内容，原审批失效且发布被拒绝。
6. producer 凭据调用发布接口被服务端拒绝。
7. 使用独立发布权限完成发布。
8. coach 加载 v3 内容，完成教材、图示、课件、案例股与媒体的核心交互。
9. 中断后从云端缺失产物恢复，不产生重复 active job 或重复内容。
10. 非法 fixtures 全部得到稳定、明确的错误，不静默降级。

### 切换

- [ ] 新仓 README、文档索引和 CI 均为现行状态。
- [ ] 旧三仓已打回退标签、指向新仓并只读。
- [ ] 没有继续向旧仓提交或从旧仓发布的路径。

## 7. 回退原则

- M5 切换前：直接停止使用新仓，旧三仓基线不变。
- 切换后代码故障：从旧仓 `pre-monorepo` 标签恢复构建和发布，不在旧仓继续新功能开发。
- 数据问题：优先使用备份和演练恢复；迁移窗口不执行不可逆清库，数据迁移与代码仓库迁移分开验收。
- 回退只用于恢复服务，不恢复新旧仓并行开发；问题修复后仍以新仓为唯一主线重新切换。

## 8. 明确不引入的过渡设施

当前阶段不引入：

- 独立 npm 契约包与 RC 发布流程。
- 跨仓 `repository_dispatch` 和兼容矩阵。
- Changesets 或多团队发布审批流。
- Bazel 等重型构建系统。
- v2/v3 长期双轨和新旧 DTO 适配层。
- 为保留历史而增加的 subtree/同步脚本维护工作。

外部协作规模、构建耗时或独立发布需求实际增长后，再按需要增加对应治理，不提前设计。

## 9. 完成定义

只有同时满足以下条件才算迁移完成：

1. M0–M5 所有退出条件满足。
2. 根目录全量验证与真实单节 E2E 通过。
3. 已确认的跨端契约阻断项全部有实现和测试，不以文档说明代替。
4. 新仓成为唯一开发、协作和发布入口，旧仓只读。
5. 新仓文档准确描述 Monorepo 后的契约真相源、目录边界和独立发布方式。
