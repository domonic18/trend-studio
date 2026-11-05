# 项目规范

## API 与契约

- 接口契约真相源在云端：`trend-coach-cloud` 对接清单 v0.8 §3.13（M9 语料生产）与 §3.14（M10 呈现层） + 需求 v0.9 C13/C14。字段变更先改云端文档，再同步 `src/host/contracts.ts`（zod + 类型单一真相）。
- 工具入参一律 zod 白名单校验；云端响应在 Host 边界校验，结构不合法报错不静默。
- 错误映射稳定码：`bad-request / forbidden / conflict / unavailable / internal`；`409 assertion_unproven` 等业务回灌按校验失败路径处理。

## 安全

- 凭据只经 dsh credentials（credential-ref）；模型密钥在 dsh 模型配置；不落日志、配置、代码。
- 云端文本按不可信数据处理：进模型前边界包裹（`host/untrusted.ts`），进工具输出前转义。
- 最小权限：不注册 shell / 文件写入工具；帧图只经云端签名 URL。

## 测试分层

- Host 单元/边界测试就近 `test/`（node:test）；契约测试对齐清单 §3.13 验收用例（T1 固化）。
- 不做端到端媒体测试（媒体在云端）；编排用假 cloud-client。

## 提交与文档

- Conventional Commits，分批提交，提交前检查敏感信息（凭据/密钥/内网地址）。
- 注释只写"为什么"；禁止多段注释与占位实现。
- 行为变更同步 AGENTS.md / docs 对应章节；接口变更必须先动云端文档。
