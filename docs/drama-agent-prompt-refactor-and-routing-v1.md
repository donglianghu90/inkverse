# 短剧生产链路重构 V1（逐 Agent 提示词 + 字段 + 路由）

## 1. 目标与原则

目标：围绕“高效生成优秀视频 + 好用的工作台体验”，把当前链路从“可跑”升级到“稳定可控可复用”。

核心原则：

- 先讲清楚，再讲漂亮：先保证主镜头可读，再做风格和镜头语言增强。
- 一致性优先于细节堆砌：人物/场景/风格锚点必须是硬约束，不是软建议。
- 单步可控：每轮重生只改一个变量，减少随机漂移和无效抽卡。
- 题材模板和视觉风格必须贯穿全链路，不只影响创建阶段。

---

## 2. 从文章中可直接借鉴的有效方法（并映射到系统）

### 2.1 借鉴点

1. “主镜”先行：先挑能讲清故事的关键镜头，再补气氛镜头。  
2. “单动作镜头”拆解：一个镜头只做一个主动词动作。  
3. 提示词简洁精准：不要堆砌过多可变细节。  
4. 角色三视图 + 场景多角度参考：先资产化再批量生成。  
5. 一次只改一个需求：提升迭代效率和可解释性。  
6. 固定模板写 Prompt：减少漏项、降低认知负担。  

### 2.2 映射到当前代码（现状）

- 当前已有 qualityTier、characterVariationIds、visualBible、qualityGate、问题镜头重生接口，基础不错。  
- 当前缺少“主镜头规划”独立步骤，导致 script/storyboard 直接连跑，后期返工高。  
- 当前分镜虽然有“单动作”规则，但没有结构化“主镜/辅镜标签”和“镜头意图字段”，难以稳定复用。

---

## 3. 当前流程体检（基于现有实现）

## 3.1 创建阶段（已具备）

- SeedAnalyzer -> SeriesDirector -> VisualAssetDesigner -> Profiler -> Strategy  
- 已支持：`visualStyleHint`、`generationMode`、`visualBible`。

主要问题：

- 题材模板影响还不够结构化，缺少统一的“题材执行画像（script/camera/qc/media）”。
- 视觉风格更多体现在描述层，缺少机读“风格锁 token”强制约束。

## 3.2 逐集阶段（已具备）

- Arc -> EpisodeIntent -> Continuity -> Script -> Dialogue -> Storyboard -> Audio -> Deterministic -> Review -> Edit -> Pacing -> Hook -> Record

主要问题：

- 缺少“主镜头计划（Master Shots）”中间层，脚本到分镜跨度大。  
- Reviewer 对“可生成风险”覆盖不足（更多是内容评分，不是生成稳定性评分）。

## 3.3 媒体阶段（已具备）

- T2I 首尾帧 -> Quality Gate -> Coherence -> I2V -> TTS -> 合成  
- 已支持：角色参考、风格参考、QC落库、问题镜头一键重生。

主要问题：

- 路由粒度偏粗：目前主要是 mode/style bucket；还缺 shot type 路由。  
- 质检指标还偏图片级，视频级（时序稳定/闪烁/运镜可读）不足。

---

## 4. 核心重构策略（建议直接执行）

### 4.1 新增步骤：Master Shot Planner（主镜头规划器）

放在 `EpisodeDirector -> Scriptwriter` 之间。

输出：

- `mustHaveShots`：本集必须出现的 6-10 个主镜（按叙事顺序）
- 每个主镜：`beatId/actionVerb/visualGoal/emotionGoal/minDuration/maxDuration`
- `optionalShots`：辅镜建议（可删）

价值：

- 保证“只看主镜也能讲懂故事”。
- 降低 storyboard 随机性和返工。

### 4.2 人物一致性从“描述”升级到“ID 锁”

- 每个 Shot 强制包含 `characterLockRefs[]`（来自 visualBible.identityPack）。
- 每个角色定义不可变锚点：发型发色、脸型、瞳色、肤色、主服装色材质。

### 4.3 场景一致性从“文本”升级到“角度包”

- 每个高频场景生成 `sceneAnglePack`：front/left/right/high/low + near/mid/wide。
- 分镜阶段不再靠纯文字“描述同一场景不同角度”，而是引用角度包。

### 4.4 重生策略标准化

- `regenMode = single_variable` 默认开启。  
- 失败原因映射到唯一修改项：
  - 身份不稳 -> 只换角色参考权重
  - 风格漂移 -> 只换 style refs/风格前缀
  - 构图差 -> 只换 camera/composition
  - 动作糊 -> 只缩短动作并重分镜

---

## 5. 逐 Agent 提示词重构清单（按现有 Agent）

## 5.1 创建链路 Agents

### A. `drama-seed-analyzer`

新增输出约束：

- `coreVisualConflict`（可直接拍出来的核心冲突）
- `genreExecutionProfile`：
  - `scriptRules[]`
  - `cameraRules[]`
  - `qcRules[]`
  - `mediaPolicyHints[]`

### B. `series-director`

新增输出约束：

- 每集新增 `mainBeatSummary`（一句话）
- 前 8 集必须有 `firstHookBudgetSec`（开场抓人时长预算）

### C. `visual-asset-designer`

强化输出：

- 角色：`identityHardLocks`（机读，不可变）
- 场景：`sceneAnglePackSeed`（后续可批量生成角度包）
- 风格：`styleTokens[]`（避免自然语言漂移）

### D. `drama-profiler` / `drama-strategy`

新增策略字段：

- `masterShotPolicy`（每集主镜数量与密度）
- `regenPolicy`（默认重生策略）
- `cameraComplexityBudget`（不同题材可用运镜复杂度）

## 5.2 逐集链路 Agents

### E. `episode-director`

新增输出：

- `episodeBeatPlan[]`（每个 beat 的冲突目标和情绪目标）
- `mustHaveShotCount`、`fillerShotCap`

### F. `scriptwriter`

新增硬规则：

- 每个 scene 必须绑定一个 `beatId`
- 必须输出 `mustShowVisuals[]`（该场景必须被镜头看到的证据）

### G. `storyboard-director`

新增输出字段：

- `isMasterShot`（主镜/辅镜）
- `actionUnitId`
- `sceneAngleRefId`
- `shotType`（portrait/dialogue/action/wide/insert）
- `regenPriority`

新增硬规则：

- 一镜一动作（主谓宾单动词）
- 主镜优先 `qualityTier=golden|standard`，辅镜可 `filler`

### H. `audio-director`

新增输出：

- `audioNarrativeRole`（推进信息/放大情绪/误导/反转前静默）

### I. `script-reviewer`

新增维度：

- `generationReadinessScore`（可生成稳定性）
- `consistencyRiskShots[]`
- `cameraReadabilityRiskShots[]`

### J. `script-editor`

改造为“最小修改修复”：

- 每次只允许修复一个 issue group（避免二次引入新问题）

### K. `hook-crafter`

新增约束：

- Hook 必须绑定 `nextEpisodeQuestion`（观众问题句）
- 预告 shot 必须来自下一集 `mustHaveShots` 的轻剧透版

### L. `episode-recorder`

新增沉淀：

- `effectivePromptFragments`（本集有效提示词片段）
- `failedPromptFragments`（失败片段）

用于后续自动提示词优化。

---

## 6. 新字段定义（建议落到 schema）

## 6.1 EpisodeIntent

```ts
masterShotPlan: Array<{
  beatId: string;
  visualGoal: string;
  emotionGoal: string;
  actionVerb: string;
  minDurSec: number;
  maxDurSec: number;
}>;
```

## 6.2 Shot

```ts
isMasterShot: boolean;
actionUnitId: string;
sceneAngleRefId?: string;
shotType: "portrait" | "dialogue" | "action" | "wide" | "insert";
regenPriority: "high" | "medium" | "low";
characterLockRefs?: string[]; // visualBible.identityPack 引用ID
styleLockRef?: string;        // visualBible.stylePack 版本引用
```

## 6.3 SceneLocation / VisualBible

```ts
sceneAnglePack?: Array<{
  angleId: string; // front_left_mid / top_wide ...
  imageUrl: string;
  cameraHint: string;
}>;
```

## 6.4 ShotMediaEntry.qc

```ts
motionScore?: number;
flickerScore?: number;
readabilityScore?: number;
failReasons?: string[];
recommendedFix?: "identity" | "style" | "camera" | "motion";
```

---

## 7. 生成路由表（高效 + 稳定）

说明：不要只按 `generationMode` 路由，要按 “镜头类型 + 风格桶 + 质量层级” 三维路由。

| shotType | qualityTier | styleBucket | i2v profile | candidateCount | QC阈值（identity/style/motion） |
|---|---|---|---|---:|---|
| portrait/dialogue | golden | any | `portrait_consistency` | 3 | 0.82 / 0.80 / 0.72 |
| action | golden | live_action/3d | `action_motion` | 3 | 0.78 / 0.76 / 0.80 |
| wide | standard | any | `wide_atmosphere` | 2 | 0.72 / 0.74 / 0.68 |
| dialogue | standard | 2d | `dialogue_stable` | 2 | 0.76 / 0.72 / 0.70 |
| insert/filler | filler | any | `budget_fast` | 1 | 0.65 / 0.65 / 0.55 |

配套策略：

- `fast` 模式：仅降低 candidateCount 和并发策略，不取消身份/风格门禁。  
- `quality` 模式：golden 允许多候选 + 更高阈值 + 低并发。

---

## 8. 工作台体验改造（与后端联动）

必做：

1. 集预览显示 `主镜头数 / 问题镜头数 / 重生建议类型分布`。  
2. 问题镜头重生支持“仅修某变量”：身份、风格、构图、动作。  
3. 每个镜头显示“失败原因 -> 自动修复建议”。

你当前已落地：

- 问题镜头识别 + 一键重生  
- Shot 卡片 QC 展示  

下一步应补：

- `recommendedFix` 可视化按钮（单变量重生）

---

## 9. 实施优先级（建议 3 个迭代）

### Iteration 1（先提稳）

- 上线 `masterShotPlan`（EpisodeDirector 输出）  
- Storyboard 增加 `isMasterShot/actionUnitId/shotType`  
- Reviewer 增加 `generationReadinessScore`

### Iteration 2（先提质）

- 场景 `sceneAnglePack` 生成与引用  
- ShotMedia QC 增加 `motion/flicker/readability`  
- 单变量重生 API

### Iteration 3（先提效）

- `effectivePromptFragments` 自动归档  
- 自动路由调参（按历史 pass rate）  
- 工作台一键“问题修复后继续批量生成”

---

## 10. 验收指标（必须上线看板）

- 首轮通过率（按 shotType、qualityTier 分层）  
- 平均重生次数（按 recommendedFix 分层）  
- 人物一致性 fail 率  
- 风格漂移 fail 率  
- 集级首次成片时长（创建到可播）

