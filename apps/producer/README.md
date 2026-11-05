# dsh-plugin-trend-producer（apps/producer）

monorepo（`~/Code/trend-studio`）的生产插件应用。趋势交易课程**生产插件**：运行在教员本机 dsh 上，驱动"约 69 集录播视频（≈35h）→ 结构化图文课程 + 交互课件"的生产 Agent 编排。

- 与学员伴学插件 `dsh-plugin-trend-coach` 配对：本插件管**生产**（写草稿、上报溯源、接受审批），云端 `trend-coach-cloud` 管**门禁与存储**，学员插件管**消费**（只读已发布内容）。
- 生产 Agent 循环、Skill 工艺包与审批卡点在本插件；云端不内嵌 Agent，发布必须云端管理台人工触发。
- 契约真相源：`trend-coach-cloud` 需求 v0.9 C13/C14 / 对接清单 v0.8 §3.13（M9）、§3.14（M10）/ 架构 v0.10 §6.5、§6.6。

详见 [AGENTS.md](./AGENTS.md)。
