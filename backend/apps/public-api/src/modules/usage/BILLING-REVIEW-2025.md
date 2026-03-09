# 计费模块架构梳理与遗漏分析（2025.03 更新）

## 一、整体数据流

```
[调用方] LlmService / EmbeddingService / MediaService
    → record(RecordUsageInput)  // costCny
    → usage_events 表 (cost_cny)
    → userDashboard / resourceDetail / resourceDetailForDrama / getBookTokenUsage
    → 前端展示
```

### 1.1 记录入口（record）

| 调用方 | kind | 触发时机 | 计费条件 |
|--------|------|----------|----------|
| LlmService.callModel | llm | 每次 LLM 调用结束 | ok ? costCny : 0 |
| EmbeddingService.embed/embedBatch | embedding | 向量生成完成 | ok ? costCny : 0 |
| MediaService.generateImage | image | 图片生成完成/失败 | ok ? costCny : 0 |
| MediaService.submitVideo | video | **不再 record**（见下） | - |
| MediaService.videoCompletionHandler | video | onJobCompleted 事件 | completed ? costCny : 0 |
| MediaService.synthesizeTtsToFile | tts | TTS 合成完成/失败 | ok ? costCny : 0 |

### 1.2 查询与展示

| 接口 | 路径 | 所有权校验 | 返回结构 |
|------|------|------------|----------|
| userDashboard | GET /usage/me/dashboard | userId 必填 | total/byModule/monthly/topResources (costCny) |
| userEvents | GET /usage/me/events | userId | 分页 events (costCny) |
| resourceDetail | GET /usage/novel/:bookId | assertNovelAccess | total/byScope/byModel (costCny) |
| resourceDetail | GET /usage/drama/:dramaId | assertDramaAccess | 同上 |
| resourceDetailForDrama | GET /drama/:dramaId/usage | DramaController 内 assertDramaOwnership | dramaId/episodes (costCny) |
| getBookTokenUsage | GET /novel/books/:bookId/token-usage | NovelController guard | totalCostCny/byProvider/byModel/chapters |

---

## 二、已实现能力

| 能力 | 状态 |
|------|------|
| 多 kind 扩展 (llm/image/video/embedding/tts) | ✅ |
| 按 provider+model 计费 (BillingResolver) | ✅ |
| 统一 scope 粒度 (episode/chapter) | ✅ |
| 失败调用统计 (apiFailedCalls) | ✅ |
| UsageController 所有权校验 | ✅ |
| NovelController getBookTokenUsage guard | ✅ |
| DramaController assertDramaOwnership | ✅ |
| 配置直接人民币 (CNY)，DB 列 cost_cny | ✅ |
| shot 归入 episode (episodeNumber) | ✅ |
| 图片/TTS 失败 costCny=0 | ✅ |
| 视频 completion 时计费，失败/取消 costCny=0 | ✅ |
| Embedding module 动态化 (drama/novel) | ✅ |
| 月度 UTC 聚合 | ✅ |

---

## 三、遗漏与架构盲区

### ~~🔴 1. 视频异步计费盲区~~（已修复）

**修复**：submit 时不再 record；`MediaJobEntity` 增加 `episodeNumber`；`onJobCompleted` 时按实际结果 record（成功计费，失败/取消 costUsd=0）。

---

### 🟠 2. 幂等缺失：idempotencyKey 未使用（中优先级）

**问题**：所有 `record` 调用均未传 `idempotencyKey`。LLM 失败重试时，每次 attempt 都可能 record，导致重复计费。

**影响**：LLM 重试场景下可能多计。

**方案**：对可能重试的调用生成 idempotencyKey，例如 `{taskName}:{resourceId}:{scope}:{attemptId}`，或与 trace/run 关联。

---

### 🟠 3. 用户取消视频无冲正（中优先级）

**问题**：`cancelVideoJob` 会 `markFailed`，但 submit 时已 record 的 usage 不会回滚。

**影响**：用户取消的任务仍会计费。

**方案**：与 1 合并——改为 completion 时计费，取消则视为失败，不 record 或 record(ok: false, costUsd: 0)。

---

### 🟡 4. resourceId 为空：孤儿事件（低优先级）

**问题**：`meta.dramaId ?? meta.bookId ?? ''` 可能为空（如 creation 早期、未传 meta）。

**影响**：事件只出现在 userDashboard，不会出现在 resourceDetail，数据难以按资源聚合。

**建议**：record 前校验，为空时打日志；或使用占位值 `_unknown` 便于排查。

---

### 🟡 5. parseScopeId 与 shot:refId 不兼容（低优先级）

**问题**：`parseScopeId` 正则为 `^(episode|chapter|scene|shot):(\d+)$`，只匹配数字 ID。若 scope 为 `shot:shot_first_frame` 等字符串 refId，会解析失败。

**现状**：已统一使用 `episode:N`，shot 归属 episode，此问题已规避。若未来恢复 shot 粒度，需扩展正则支持 `shot:[\w-]+`。

---

### 🟡 6. BILLING.md 文档过时（低优先级）

**问题**：仍写 USD、pricing.multiplier 等，与当前「配置即人民币」不符。

**建议**：更新为 CNY，移除 multiplier 相关描述。

---

### 🟡 7. 配置热更新（低优先级）

**问题**：BillingResolver 仅在构造函数从 ConfigService 读取，配置变更需重启。

**建议**：若需热更新，改为每次 resolve 时读取，或增加配置变更回调。

---

### ~~🟢 8. 接口字段命名语义~~（已修复）

**已修复**：DB 列 `cost_cny`，返回字段 `costCny`、`llmCostCny` 等。

---

### ~~🔴 9. 前端未同步更新~~（已修复）

**已修复**：BookTokenUsage 改为 totalCostCny、estimatedCostCny；QualityDashboard、index 已更新；fmtCost 改为 ¥ 展示。

---

## 四、架构可扩展性检查

| 维度 | 支持情况 |
|------|----------|
| 新增 kind (如 audio) | ✅ 在 USAGE_KINDS 扩展即可 |
| 新增 module (如 comic) | ✅ 在 MODULE_SCOPE_GRANULARITY 扩展即可 |
| 新增 scope 粒度 (如 scene) | ⚠️ 需扩展 scope 解析正则与 items 归类逻辑 |
| 新增 provider | ✅ 在 BillingResolver 配置中增加即可 |
| 按 model 细分计费 | ✅ 支持嵌套配置 |
| 按时长/按字符计费 | ⚠️ 需扩展 BillingResolver 与 record 参数 |

---

## 五、修复优先级建议

| 优先级 | 问题 | 影响 |
|--------|------|------|
| 高 | 视频异步计费（失败/取消仍计费） | 计费准确性 |
| 中 | idempotencyKey 未使用 | 重试多计 |
| 中 | 用户取消视频无冲正 | 与高优先级合并处理 |
| 低 | resourceId 空校验 | 数据质量 |
| 低 | BILLING.md 更新 | 文档一致性 |
| 低 | 配置热更新 | 运维便利 |

---

## 六、视频计费改造建议（方案 A 细化）

1. **扩展 MediaJobEntity**：增加 `episodeNumber`（nullable），`createJob` 时从 opts 传入。
2. **移除 submitVideo 中的 record 调用**。
3. **在 MediaService 或新建 VideoCompletionBillingHandler** 中监听 `jobService.events.on('completed')`：
   - `status === 'completed'`：record(ok: true, costUsd, ...)
   - `status === 'failed'`：record(ok: false, costUsd: 0, ...)
4. **从 Job 反查上下文**：job 有 dramaId, refId, userId, request, episodeNumber；scope 用 `episode:N`，无 episodeNumber 时 fallback `shot:refId` 或 `creation`。

---

## 七、迁移顺序

部署前需执行（按顺序）：

1. `202603090001` - 扩展 usage_events scope/kind 列
2. `202603090002` - media_jobs 添加 episode_number
3. `202603090003` - usage_events 列 cost_usd → cost_cny
