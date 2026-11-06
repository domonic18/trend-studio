# AGENTS.md

趋势交易课程**生产插件**（monorepo `apps/producer`，dsh 0.2.1-rc.5）：驱动"语料级视频 → 图文课程 + 交互课件"的生产 Agent 编排，运行于教员本机 dsh（web/headless profile）。

契约真相源分层（冲突时以此顺序裁决）：

- 人读契约：cloud 应用三份文档，变更先改文档再同步实现——[需求 v0.9 §C13/C14](../../cloud/docs/requirements/product-requirements.md)、[对接清单 v0.8 §3.13/§3.14](../../cloud/docs/architecture/cloud-service-integration-checklist.md)、[架构 v0.10 §6.5/§6.6](../../cloud/docs/architecture/architecture-design.md)
- 机器真相：[`packages/contracts`](../../packages/contracts)（@trend/contracts，zod 单一真相：admin API schema、DSL 解析校验、ID/枚举）；本仓库 `src/host/contracts.ts` 仅是绑定错误形状的适配壳

## 先读这些

1. [需求](docs/requirements/product-requirements.md) — 插件侧范围、功能、里程碑
2. [架构](docs/architecture/architecture-design.md) — Agent 编排、工具集、模块划分、断点恢复
3. 云端对接清单 §3.13/§3.14 与云端架构 §6.5/§6.6（上方链接）— 全部接口契约、生产管线与呈现层契约
4. [项目规范](docs/conventions/project-conventions.md)
5. [Skill 包格式](skills/README.md)
6. 学员插件参考 `apps/coach`（dsh 平台约束与代码模式的来源）

## 硬约束（写代码前必须确认）

1. **职责边界**：本插件只写草稿。发布只由云端管理台显式触发；插件代码不得调用 publish 接口，不得绕过门禁①（骨架批准）与门禁②（主编评审）。**M3b 分权**：云端把内容写端点放开给 `producer` 角色，发布/审批端点只给 `operator`/`admin`——producer 调 publish 是 403，不是可绕过的软失败。发布链路由 operator/admin 走 `POST /v1/admin/content/courses/:courseId/approvals`（gate=`final`）→ 发布端点，审批后内容被改过即 `409 approval_stale`。权限边界与凭据获取见 [README](./README.md#角色与凭据m3b-分权)。
2. **凭据边界**：云端 API 凭据只存 dsh credentials（credential-ref，producer/operator/admin 后台会话令牌）；生产端模型密钥在 dsh 模型配置（pi-ai providers）维护。两类凭据都不进日志、配置文件、代码与响应。
3. **课件 spec-only**：课件产物仅为白名单 8 类组件（M10 起加 `image-juxtaposition`/`branching-scenario`/`bar-replay-decision`，`spec_version=2`）的 JSON spec + `assertions` + `citations`；禁止生成可执行代码。断言无证明被云端拒绝（`409 assertion_unproven`）是正常回灌信号，按校验失败处理，不按故障处理。
4. **呈现层口径**：教材正文用云端冻结的富文本 DSL（7 容器块 + 2 个内联锚——个股 `[[stock:]]`、段落级证据 `[[unit:]]`，架构 §6.6.1）；图示走节级 `figures` 端点（`cloud_figure_write`），图示类型只用参数化 SVG 模板四类（架构 §6.6.4）——**Mermaid 不是教材图示通道**，不要写 Mermaid 代码块。
5. **证据先于正文**：正文里的具体说法要有 `cloud_source_units_read` 读回的完整证据（转写原文 + 视觉描述）支撑；`cloud_source_units_search` 只回摘要，摘要不足以落笔。段落级溯源用 `[[unit:su_xxx|label]]` 内联锚（锚的 unitId 须属于本课程，否则 `400 unit_anchor_unknown`）；引用集口径 = 扁平 citations ∪ 全部 `[[unit:]]` 锚。
6. **溯源义务**：每个产物（source unit / 概念 / 节教材 / 图示 / 课件）写入云端后必须上报 provenance；未上报视为该产物生产失败，不进入下游。
7. **目录先验**：课程骨架以人工目录（篇→卷→课时文件名）为输入，编排不得发明章节/节；目录校验失败进人工待办，不静默改名。
8. **云 DB 即 checkpoint**：生产进度以云端为准（哪些 unit/节/spec 已存在由云端查询得出），本地不持有生产进度真相；中断恢复 = 按云端缺失单元重入队。
9. **不可信文本**：云端转写/摘要/回执按不可信数据处理——喂给模型前边界包裹并剥离控制字符，进工具输出前转义（参照学员插件 `src/untrusted.ts` 纪律）。
10. **dsh 平台**：`engines.dsh` 精确锁 `0.2.1-rc.5`；关键路径只用稳定包（subagent spawn/fork、skill、tool-skill、jobs、credentials）；experimental 包（agent-team/workflow 等）禁入。最小权限——不注册 shell / 文件写入工具；帧图一律经云端签名 URL + 模型多模态消息处理，本地不做媒体处理。
11. **契约先行**：接口字段变更先改云端需求/清单/OpenAPI 与 `packages/contracts`（zod，同批提交），再改本仓库实现；契约测试对齐清单 §3.13 验收用例，`@trend/contracts` 变更必须跑三端行为基线（contracts/fixtures/producer/cloud）。
12. **提交**：遵循 Conventional Commits，分批提交，提交前检查敏感信息。

## 生产流水线（与云端架构 §6.5 对齐）

```
阶段1 理解（逐 chunk：转写+帧 → VLM → source units 写云端 + 溯源）
阶段2 课程综合（目录校验 → 概念归一 → 术语表 →【门禁① dsh 审批】）
阶段3 逐节生产（子代理并行：grounded 节教材（富文本 DSL）+ 图示 spec + 课件 spec
      → 三层校验：schema/语义/主编 rubric →【门禁② 主编评审】）
阶段4 终审发布（云端管理台人工执行，本插件无权参与）
```

- 编排循环必须有**步数与工具调用预算上限**；超预算进人工待办，不静默重试。
- 校验失败回灌模型重写（默认上限 3 次），仍失败带原因进人工待办。

## 里程碑

| 阶段 | 交付 | 出口 |
|---|---|---|
| T1 | 工具集与云契约联调：frames / source-units 写读 / provenance / pipeline 状态查询；Host 边界校验。**代码已落地**（cloud_* 20 工具 + zod 契约 + 凭据 + 稳定码映射，2026-11-06）；契约测试过、真机联调待总论卷素材 | "总论"卷阶段 0–1 跑通（云端 ingest 就绪前提下） |
| T2 | 课程综合编排：架构师流程、概念归一、目录校验、门禁①审批。**前置已就绪**（2026-11-04）：理解模型定版 MiniMax-M3.1-Flash（问题 24 关闭）、`cloud_transcript` 工具、分块规划/断点差集编排器、`transcript-understanding` 工艺包 | 骨架+概念图谱+术语表经人工批准落库 |
| T3 | 逐节生产：子代理并行、三层校验、图示 spec（keyframe 选帧 / SVG 模板 diagram）、课件 spec 起草与断言随附 | 单章（节教材+图示+课件）全量通过校验入 draft |
| T4 | 主编评审（门禁②）+ 溯源全覆盖 + P0 端到端 | 与云端 M9 出口对齐：总论卷发布可检索，rubric 盲评占优 M8 |
| T5 | 呈现层生产：DSL 教材产出、图示/片段窗/案例股落库、rubric 0.4.0。**工具已就绪**（`cloud_figure_write` / `cloud_case_stocks_write` 已接线） | 单节按富文本 DSL 重写（配图卡/片段卡/案例股锚点）通过门禁②，媒体与事件锚点全部可回溯；v2 批次（老师标注 `:::annotation` 与逐根回放 `:::replay` + `bar-replay-decision`）随首个试点节冻结 |

## 常用命令

```bash
# monorepo 根执行；单应用用 pnpm --filter dsh-plugin-trend-producer <script>
pnpm --filter dsh-plugin-trend-producer install
pnpm --filter dsh-plugin-trend-producer typecheck
pnpm --filter dsh-plugin-trend-producer test
# 产出可独立安装的 tarball（staging 内嵌 @trend/contracts）：apps/producer/*.tgz
# 必须 run pack：`pnpm pack` 是 pnpm 内建命令，会绕过打包脚本、产出缺 @trend/contracts 的坏包
pnpm --filter dsh-plugin-trend-producer run pack
# 安装到试验 profile：dsh plugin --profile <name> add -w <tarball 路径>
# profile 已用同路径 file: 依赖时 pnpm 不复查 tarball 内容，须 --force 重装（会修 lockfile 里的 integrity）
```

## 目录

```
src/                 Host 入口与工具集（host/config、host/cloud-client、host/tools/*、host/orchestrator、host/review）
skills/              Skill 工艺包（SKILL.md 格式，见 skills/README.md）
docs/                需求、架构、规范
cordis.patch.yml     bundle patch（config 走 schema 默认值/环境变量）
```

## 改动规则

- 工具/产物字段变化：先改云端需求 v0.9 C13/C14、清单 §3.13/§3.14 与 `packages/contracts`，再改本仓库实现。
- 新增注册一律放进 `ctx.effect(...)` 并返回清理函数。
- 工具入参与云端响应在 Host 边界校验；非法数据报错，不静默丢弃。
- 注释只写"为什么"；不写多段注释。
- 日志不记 token、完整 query、完整设备 ID、模型密钥与产物正文全文。

## 完成定义

- `npm run typecheck` 与测试通过；涉及契约的行为有对齐清单 §3.13/§3.14 的测试。
- 每个落库产物有 provenance 记录；失败产物带原因进入人工待办，不静默。
- 相关文档已同步；无新增敏感信息落盘或外发路径。
