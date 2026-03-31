# 用量计费规则说明

不同模型对应不同计费规则，均通过配置驱动，支持按 provider、model、粒度扩展。**配置值单位均为人民币（CNY）**。

## 1. LLM（大语言模型）

- **维度**：provider + tier（creative/standard/lightweight）
- **规则**：输入/输出分别计价，单位 CNY/百万 tokens
- **配置**：`llm.cost`、`llm.claude.cost`、`llm.openai.cost`

## 2. Embedding（向量模型）

- **维度**：provider（当前单 provider，可扩展）
- **规则**：按 tokens 计价，单位 CNY/百万 tokens
- **配置**：`llm.embedding.costPer1MTokens`

## 3. Image（图片生成）

- **维度**：provider → model（可选）→ size（可选）
- **规则**：按张计价（CNY）
- **配置**：`media.cost.image`

## 4. Video（视频生成）

- **维度**：provider → quality（可选）
- **规则**：按条计价（CNY），**在任务完成时计费**（提交成功不计费，失败/取消不计费）
- **配置**：`media.cost.video`

## 5. TTS（语音合成）

- **维度**：provider → model/voice（可选）
- **规则**：按条计价（CNY）
- **配置**：`media.cost.tts`

## 计费流程

1. **记录时**：各服务在调用后按规则计算 cost（CNY），写入 `usage_events`；**仅成功调用计费**，失败 cost=0
2. **视频特殊**：submit 不 record，在 `onJobCompleted` 时按实际结果（completed/failed）record
3. **聚合时**：UsageLedgerService 直接 `SUM(cost_cny)`
4. **展示时**：返回 `costCny`，前端按 `byKind`、`byProvider`、`byModel` 展示

## 扩展新模型

1. 在配置中补充对应 provider/model 的单价（CNY）
2. 若需新粒度，在 `BillingResolverService` 中新增 `resolveXxxCostCny` 方法
3. 调用方传入参数，由 BillingResolver 解析单价并计算 cost
