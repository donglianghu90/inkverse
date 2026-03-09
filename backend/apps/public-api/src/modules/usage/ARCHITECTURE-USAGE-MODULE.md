# Usage 模块目录与类型架构

## 一、当前结构

```
usage/
├── usage.types.ts          # 领域常量、类型、工具函数（混合）
├── billing-config.types.ts # 计费配置类型（BillingResolver 用）
├── usage-ledger.service.ts # RecordUsageInput 定义在此（服务内联）
├── usage.controller.ts
├── usage-access.service.ts
├── billing-resolver.service.ts
├── entities/
│   └── usage-event.entity.ts
├── BILLING.md
├── BILLING-REVIEW-2025.md
└── ARCHITECTURE-REVIEW.md
```

## 二、现有问题

### 2.1 usage.types.ts 职责混杂

| 内容 | 类型 | 建议归属 |
|------|------|----------|
| USAGE_KINDS, UsageKind, TOKEN_AWARE_KINDS | 常量/枚举 | 领域常量 |
| ScopeGranularity, MODULE_SCOPE_GRANULARITY | 类型/配置 | scope 领域 |
| KindBucket, UsageBucketView | 聚合视图接口 | 契约（API 输出） |
| parseScopeId, buildScope | 工具函数 | scope 工具 |

**问题**：类型定义 + 常量 + 工具函数混在同一文件，不利于按需引用和职责清晰。

### 2.2 契约分散

- **RecordUsageInput**：定义在 usage-ledger.service.ts，是 usage 模块对外的「写入契约」
- **UsageBucketView**：定义在 usage.types.ts，是 API 的「返回契约」
- **KindBucket**：usage.types 与 usage-ledger 各有一套，形状相同，存在重复

### 2.3 与项目约定不一致

- **media** 模块有 `interfaces/media-provider.interface.ts`，把 Provider 契约集中管理
- **usage** 模块没有 `interfaces/`，契约分散在 types 和服务中

---

## 三、推荐架构

### 3.1 目录结构

```
usage/
├── interfaces/                    # 契约层（新增）
│   ├── record-usage.interface.ts # 写入契约：RecordUsageInput
│   └── usage-bucket.interface.ts # 返回契约：UsageBucketView, KindBucket
├── types/                         # 领域类型（可选拆分，见下）
│   ├── kind.types.ts              # USAGE_KINDS, UsageKind, TOKEN_AWARE_KINDS
│   └── scope.types.ts            # ScopeGranularity, MODULE_* , parseScopeId, buildScope
├── usage.types.ts                 # 保留为 barrel，或合并为单文件（见 3.2）
├── billing-config.types.ts
├── usage-ledger.service.ts
├── ...
```

### 3.2 两种实现方案

**方案 A：轻量（推荐）**

- 新增 `interfaces/`，将 RecordUsageInput、UsageBucketView、KindBucket 移入
- 保留 `usage.types.ts`，只放领域常量 + scope 相关（类型 + 工具）
- `billing-config.types.ts` 保持不变

**方案 B：彻底拆分**

- `interfaces/`：所有契约
- `types/kind.types.ts`：kind 常量
- `types/scope.types.ts`：scope 类型与工具
- `usage.types.ts` 改为 `types/index.ts` 做 barrel 导出

### 3.3 职责划分原则

| 层级 | 内容 | 示例 |
|------|------|------|
| **interfaces** | 跨模块/对外契约 | RecordUsageInput（LlmService 传入）、UsageBucketView（API 返回） |
| **types** | 领域模型、常量、工具 | UsageKind、ScopeGranularity、parseScopeId |
| **entities** | 持久化模型 | UsageEventEntity |
| **config types** | 配置结构 | billing-config.types.ts |

---

## 四、迁移步骤（方案 A）

1. 新建 `interfaces/record-usage.interface.ts`，移入 RecordUsageInput
2. 新建 `interfaces/usage-bucket.interface.ts`，移入 KindBucket、UsageBucketView
3. `usage.types.ts` 移除 KindBucket、UsageBucketView，保留 kind/scope 相关
4. `usage-ledger.service.ts` 删除本地 KindBucket，改为从 interfaces 导入
5. 更新所有引用

---

## 五、是否必须迁移

**当前结构可接受**，若模块规模不大：

- usage.types.ts 约 80 行，仍在可控范围
- 与 media 的 interfaces 风格不完全一致，但非硬性规范

**建议迁移**，若：

- 计划引入 usage 相关的更多接口（如用量报表、计费事件等）
- 希望 usage 与 media 等模块的目录风格统一
- 需要更清晰的「契约 vs 领域类型」边界
