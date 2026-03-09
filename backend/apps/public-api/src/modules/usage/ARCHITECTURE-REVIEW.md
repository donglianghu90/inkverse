# 计费模块架构梳理与遗漏分析

## 一、整体数据流

```
[调用方] LLM/Embedding/Media
    → record(RecordUsageInput)
    → usage_events 表
    → userDashboard / resourceDetail / resourceDetailForDrama
    → 前端展示
```

---

## 二、已实现能力

| 能力 | 状态 |
|------|------|
| 多 kind 扩展 (llm/image/video/embedding/tts) | ✅ |
| 按 provider+model 计费 (BillingResolver) | ✅ |
| 统一 scope 粒度 (episode/chapter) | ✅ |
| 失败调用统计 (apiFailedCalls) | ✅ |
| Drama usage 所有权校验 | ✅ |
| 人民币折算 (pricing.multiplier) | ✅ |

---

## 三、遗漏与待改进

### 1. 安全：UsageController 无所有权校验

**位置**：`GET /usage/novel/:bookId`、`GET /usage/drama/:dramaId`

- 无 `assertBookOwnership` / `assertDramaOwnership`
- 任意登录用户可查任意 book/drama 用量
- **建议**：增加所有权校验，或标记废弃并统一走 Novel/Drama 模块的带 guard 接口

---

### 2. 安全：userId 为空时数据混乱

**位置**：`userDashboard(userId)`、`userEvents(userId)`

- 当 `req.user?.userId ?? req.user?.id` 为空时，userId = `''`
- 会查询 `user_id = ''` 的记录，可能混入未正确传 userId 的调用
- **建议**：userId 为空时直接返回空结构或 401，避免错误聚合

---

### 3. 幂等：未使用 idempotencyKey

**位置**：LlmService、EmbeddingService、MediaService 的 `usageLedger.record`

- 未传入 `idempotencyKey`
- LLM 重试会导致多次记录（每次失败一次、成功一次）
- 失败调用成本多为估算，重试会重复计费
- **建议**：对可能重试的调用生成 idempotencyKey（如 `{taskName}:{resourceId}:{scope}:{timestamp}`），或明确「失败不计费」策略

---

### 4. scope 归属：shot 级用量未归入 episode

**位置**：`resolveScope`、`resourceDetailForResource`

- 图片/视频 scope：`shot:refId`（如 shot_first_frame）
- 媒体编排调用 `generateImage` 时未传 `episodeNumber`
- `resourceDetailForResource` 仅匹配 `episode:\d+`，`shot:xxx` 不会进入任何 episode
- 导致 `total` ≠ `creation` + Σ`episodes`，出现「其他 scope」缺口
- **建议**：媒体编排调用时传入 `episodeNumber`，统一用 `episode:N` 作为 scope，把 shot 归属到对应集

---

### 5. resourceId 为空：孤儿事件

**位置**：各 record 调用处

- `meta.dramaId ?? meta.bookId ?? ''` 可能为 `''`
- 这类事件只出现在 `userDashboard`，不会出现在 `resourceDetail`
- **建议**：record 前校验 resourceId，为空时打日志并可选忽略，或使用占位 resourceId（如 `_unknown`）以便排查

---

### 6. 配置：pricing.multiplier 未配置

**位置**：`public.properties`、UsageLedgerService

- `pricing.multiplier` 默认 10.8，无配置项
- **建议**：在 `public.properties` 中增加 `pricing.multiplier = 10.8`，便于按环境调整

---

### 7. 时区：月度聚合依赖服务器时区

**位置**：`userDashboard` 的 `TO_CHAR(e.created_at, 'YYYY-MM')`

- `created_at` 为 timestamptz，按数据库/服务器时区分组
- 多时区用户可能导致月份划分不一致
- **建议**：统一使用 UTC，如 `TO_CHAR(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM')`

---

### 8. 失败计费：媒体失败可能多计

**位置**：MediaService 失败分支

- 图片/视频/TTS 失败时仍按单价记录 costUsd
- 多数 provider 对失败调用不计费
- **建议**：失败时 `costUsd = 0`，或通过配置控制是否计失败费

---

### 9. Embedding：module 写死为 novel

**位置**：`embedding.service.ts`

- `module: 'novel'` 写死
- 若 Drama 未来使用 embedding，会错误归入 novel
- **建议**：根据 meta 解析 module，或由调用方传入 module

---

### 10. BillingResolver：配置仅启动时加载

**位置**：`BillingResolverService` 构造函数

- 单价在构造时从 ConfigService 读取
- 配置变更需重启
- **建议**：如需热更新，改为每次 resolve 时从 ConfigService 读取，或增加配置变更回调

---

## 四、架构可扩展性检查

| 维度 | 支持情况 |
|------|----------|
| 新增 kind (如 audio) | ✅ 在 USAGE_KINDS 扩展即可 |
| 新增 module (如 comic) | ✅ 在 MODULE_SCOPE_GRANULARITY 扩展即可 |
| 新增 scope 粒度 (如 scene) | ⚠️ 需扩展 scope 解析正则与 items 归类 |
| 新增 provider | ✅ 在 BillingResolver 配置中增加即可 |
| 按 model 细分计费 | ✅ 支持嵌套配置 |
| 按时长/按字符计费 | ⚠️ 需扩展 BillingResolver 与 record 参数 |

---

## 五、推荐修复优先级

| 优先级 | 问题 | 影响 |
|--------|------|------|
| 高 | UsageController 所有权校验 | 安全 |
| 高 | shot 级 scope 归入 episode | 数据一致性 |
| 中 | userId 空校验 | 数据质量 |
| 中 | 失败计费策略 (costUsd=0?) | 计费准确 |
| 低 | pricing.multiplier 配置化 | 运维 |
| 低 | 月度 UTC 时区 | 多时区场景 |
