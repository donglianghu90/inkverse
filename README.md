# inkverse

inkverse 是一个基于大语言模型（LLM）的 AI 创作引擎，支持**小说**和**短剧**两种创作模式——从故事构思到成品的完整生成流程。

## 短剧引擎（Drama Module）

独立于小说模块的短剧生成引擎，从创意到逐镜头 Shot JSON 的完整链路。

### 创建流程（5步）
`SeedAnalyzer` → `SeriesDirector`（全剧大纲+分集概要+付费卡点） → `VisualAssetDesigner`（角色锁脸+配音+场景+风格指南） → `DramaProfiler`（编剧手册） → `DramaStrategy`（付费/悬念/角色预算策略）

### 逐集生成 Pipeline（13步）
`ArcDirector`（段落规划） → `EpisodeDirector`（集级意图） → `ContinuityGuard`（连续性预检） → `Scriptwriter`（剧本） → `DialogueCoach`（台词润色） → `StoryboardDirector`（分镜Shot+T2V visualPrompt） → `AudioDirector`（BGM/SFX/环境音/TTS标注） → `DeterministicChecker`（硬规则校验） → `ScriptReviewer`（质量审核） → `ScriptEditor`（精修循环，最多2轮） → `PacingAnalyzer`（节奏分析） → `HookCrafter`（集末悬念+下集预告） → `EpisodeRecorder`（知识记录+闪回标注）

### 数据模型
- `DramaState`：顶层聚合，包含 seed/outline/characters/locations/visualStyle/strategy/promptProfile/secretLedger/flashbackBank 等
- `Shot`：最小粒度，每个 Shot 包含 camera（角度/运动/构图/景深）、characters（动作/表情/位置）、dialogue（TTS emotion/volume/pace）、audio（bgm/sfx/ambience）、visualPrompt（英文 T2V 提示词）、subtitle、duration、transition
- `EpisodeLoreRecord`：知识记录，含 characterStateDeltas/plotAdvances/newSecrets/flashbackCandidates

### 题材模板系统
- 10 个系统预置短剧题材模板：霸总/甜宠/战神/穿越/宫斗/复仇/重生/悬疑/都市/古装
- 每个模板包含：`seedHints`（爽点预设/冲突模式/付费策略/视觉风格/台词风格）、`audienceTags`、`protagonistFocusTags`、`toneTags`、`platformTags`
- 用户可自定义题材模板（CRUD + 克隆），系统模板自动同步
- `DramaGenreTemplateEntity` 持久化于 `drama_genre_templates` 表，字段设计参考小说模板但更轻量

### SSE 实时进度
- **创建阶段**：`GET /api/drama/:dramaId/create-sse` — 订阅 5 步创建流程进度（种子分析→大纲→视觉设计→编剧手册+策略→完成）
- **逐集生成**：`GET /api/drama/:dramaId/episodes/generate-sse?count=N` — 触发生成并推送 13 步 Pipeline 进度，完成后返回结果
- **纯监听**：`GET /api/drama/:dramaId/episodes/progress-sse` — 只监听不触发，用于多端观察
- `DramaProgressService`：EventEmitter 驱动，支持 `create`/`episode` 两种 phase，15 秒心跳保活
- 前端 CreateDrama 页面在第 5 步展示实时进度条和步骤状态
- 前端 DramaWorkbench 生成时展示进度条和当前步骤

### API 端点
- `POST /api/drama` — 创建短剧（触发5步创建流程）
- `GET /api/drama` — 列表
- `GET /api/drama/:dramaId` — 详情（含完整 DramaState）
- `POST /api/drama/:dramaId/episodes/generate?count=N` — 生成N集
- `GET /api/drama/:dramaId/episodes` — 分集列表
- `GET /api/drama/:dramaId/episodes/:episodeNumber` — 集详情（含 script/storyboard/review/loreRecord）
- `GET /api/drama/:dramaId/visual-assets` — 视觉资产
- `GET /api/drama/:dramaId/create-sse` — 创建进度 SSE
- `GET /api/drama/:dramaId/episodes/generate-sse?count=N` — 生成进度 SSE
- `GET /api/drama/:dramaId/episodes/progress-sse` — 纯监听进度 SSE
- `GET /api/drama/genre-templates/list` — 题材模板列表
- `GET /api/drama/genre-templates/:id` — 题材模板详情
- `POST /api/drama/genre-templates` — 创建自定义题材模板
- `PUT /api/drama/genre-templates/:id` — 更新题材模板
- `DELETE /api/drama/genre-templates/:id` — 删除题材模板
- `POST /api/drama/genre-templates/:id/clone` — 克隆题材模板

### 前端页面
- 书架页 Tab 切换（小说/短剧）
- 创建短剧页（`/novel/create-drama`）：4步向导（创意→题材模板选择&平台→主线&剧名→规模配置）+ SSE 实时进度
- 短剧工作台（`/novel/drama/:dramaId`）：基本信息+SSE实时进度+分集列表+集详情弹窗（剧本场景/分镜概览/质量审核）

## 写作与生成优化

- **潜台词与感官锚定 (Subtext & Sensory Anchors)**：在场景规划阶段，强制引入潜台词约束和具体感官细节（如"生锈的铁腥味"），逼迫AI践行 *Show, Don't Tell*，消除AI味。
- **事前角色声音锚定 (Proactive Voice Anchoring)**：在生成意图时，动态提取核心出场角色的标志性台词/口癖作为生成参考，避免角色声音漂移。
- **场景过渡平滑 (Scene Transition Smoothing)**：在编辑精修阶段，增加专门针对场景切换的审查指令，确保视角转移和情绪延续如丝般顺滑。
- **伏笔唤醒期 (Foreshadowing Reminder Phase)**：在计划回收伏笔的前 1-3 章，通过卷级导演下发指令，安排微弱的视觉或记忆唤醒，为正式回收做心理铺垫。
- **并发场景生成 (Parallel Scene Generation)**：在章节工作流中，识别并并发生成平行视角（Parallel POV）的场景，大幅提升单章生成速度。
- **命名哲学与阶段激活 (Naming Philosophy & Stage Activation)**：开书阶段按题材生成 `namingConvention` 与主角 `nameGrowthArc`；每章仅注入轻量命名风格约束，主角名字的象征重量仅在卷级 `entry/climax` 阶段低频激活，避免过度提示影响写作自然度。

## 写作模式（writingMode）

创建书籍时可选择写作模式，控制全链路生成策略：

- **`commercial`（畅读模式，默认）**：商业节奏优先，追求翻页欲与读者满足感。核心循环采用成熟网文套路，多巴胺调度严格执行，质量门控以 engagement/hookStrength 为重。
- **`literary`（文学探索模式）**：主题深度与独创性优先，允许实验性叙事（内省章、碎片叙事、氛围章）。具体影响：
  - **SeedAnalyzer**：temperature 0.6→0.75，核心循环允许自创，emotionalNeeds 扩展 4 类文学情感需求，概念评估默认分降至 5（消除虚高）
  - **IntentAgent**：temperature 0.5→0.7，允许探索型目标（内省/氛围），多巴胺调度降级为"仅供参考"
  - **CreativeWriter**：温度整体上浮 +0.05，铁律放松结尾强制钩子，新增 introspective/fragmentary/atmospheric 章型
  - **HookCrafter**：新增安静共鸣、开放问题、意象消融等文学结尾技法，重复窗口从 3→1
  - **Reviewer**：新增 `originality` 评分维度（权重 1.5），hookStrength 权重降低 40%，proseQuality/characterDepth 权重提高 30%
  - **ChapterWorkflow**：质量门控阈值降低 1 分，编辑精修阈值降低 0.5 分
  - **VolumeDirector**：要求每卷 MiniArc 至少 1 章使用实验章型
  - **ScenePlanner**：新增 introspection/atmospheric/thematic 场景 purpose

前端：CreateBook 页面「叙事聚焦」下方新增模式选择器卡片。后端：`CreateBookCoreDto.writingMode` 传递至 `storySeed.writingMode`，全链路通过 `state.seed.writingMode` 读取。

## 新建书受众策略（v2）

- 仅对新建书生效：创建参数可选传 `protagonistFocus`、`tonePreference`、`audienceTags`、`writingMode`，用于模板多维匹配。
- 模板匹配采用加权策略：`genre + audience + protagonistFocus + tone`，并对历史/悬疑/军事题材启用更高题材保护权重。
- 冷启动默认权重由 `backend/config/public.properties` 配置：
  - `novel.audienceStrategy.weight.genre`
  - `novel.audienceStrategy.weight.audience`
  - `novel.audienceStrategy.weight.protagonistFocus`
  - `novel.audienceStrategy.weight.tone`
  - `novel.audienceStrategy.maxAudienceInfluence`
- 受众策略会注入 `intent / scene-planner / creative-writer / reviewer` 四个核心 Agent，保证开书到成章一致。

## 书级策略层（L2）与卷切换刷新

- 新增 `bookStrategy`（L2 中层策略）：位于“题材基线（L1）”与“章节动态（L3）”之间，避免同题材小说提示词同质化。
- 开书时自动生成 `bookStrategy`，包含：
  - `coreNarrativeContract`（本书叙事契约）
  - `toneGuardrails`（调性护栏）
  - `audienceDeliveryPolicy`（读者交付策略）
  - `hookCadencePolicy / threadPolicy / characterFocusPolicy`（卷级三策略）
- 卷切换时仅刷新三项卷级策略：`hookCadencePolicy`、`threadPolicy`、`characterFocusPolicy`，其余书级策略保持稳定，减少风格漂移。
- 三策略会注入 `intent / scene-planner / hook-crafter / creative-writer`，用于统一卷内节奏、伏线开合和角色聚焦。
- `hook-crafter` 增加钩子类型硬过滤：输出 `selectedHookType` 并校验必须命中允许列表（优先策略偏好并避开重复窗口）。
- 若 `hook-crafter` 两次仍未命中允许类型，会触发“单一允许类型强制回退”重生成并记录告警日志，避免策略失效。
- `intent` 的 `threadGuidance.maxNewThreads` 会按 `threadPolicy.maxNewThreadsPerChapter` 做硬钳制，章节工作流层再做一次兜底钳制。
- `arc-director` 追加策略硬约束后处理：`riskBudget` 按 `arcStage` 钳制、当线程策略禁止新增支线时自动补充 `shouldAvoid`、并把 `chapterEndingDirective` 合并进 `hookDirective`。
- `scene-planner` 追加硬约束后处理：过滤禁用角色出场、`seed` 动作按 `maxNewThreads` 钳制、并按 `characterFocusPolicy.minCharacterMomentPerChapter` 自动补齐角色时刻。

## 题材模板字段规范（18 系统模板 + 新增模板）

- 每个模板应包含受众元数据：`audienceTags`、`protagonistFocusTags`、`toneTags`、`relationshipDensity`、`hardConstraints`、`softPreferences`。
- 新建模板发布前必须至少提供：`audienceTags`、`protagonistFocusTags`、`toneTags`。
- 建议规则：题材硬约束写入 `hardConstraints`（不可破），风格偏好写入 `softPreferences`（可调优）。
- `seedHints.namingDefaults` 现为强约束字段：系统模板初始化会自动补齐；用户模板在创建/更新时若缺失也会按 `genreKey` 自动回填；启动阶段会对历史模板执行一次缺失回填，避免命名兜底退化为通用风格。

## 认证会话策略

- 同账号支持多端同时在线，每次登录会新增一个独立会话 token，不会覆盖其他端已登录 token。
- `POST /api/inkverse/admin/auth/logout` 默认仅注销当前请求携带的 token，不会影响同账号其他在线端。
- 修改密码会触发账号下全部会话 token 失效，所有端需重新登录。

## 章节工作流断点续传

- 章节生成过程中会把关键步骤输出写入 `workflow_executions.step_outputs`（JSONB），用于中断后恢复。
- 每条运行会记录 `owner_instance_id` 和 `heartbeat_at`，用于多实例场景的执行权判定与失活检测。
- 运行中的检查点、步骤输出、完成/失败状态写回均受 owner 约束，实例失去执行权后不会覆盖新的持有者状态。
- 工作流关键步骤执行前会实时校验 owner，若执行权已转移会快速中止，避免额外 LLM 消耗。
- 服务重启后或失败重试时，再次触发同一 `bookId + chapterNumber` 的生成，会优先恢复最近可续跑任务，跳过已完成步骤，减少重复 LLM 调用。
- 当缓存结构异常或不完整时，会自动降级为该步骤重算，不阻塞整章生成。
- 启动恢复策略会将超过 5 分钟仍处于 `running` 的章节工作流标记为 `interrupted`，避免异常退出后状态长期残留。

## 章节上下文与记忆策略（v3）

- 上下文窗口采用常量绑定：`buildCompactContext` 的 `maxChapterSummaries` 与远程记忆排除窗口 `excludeRecentN` 同源（默认 `6`），避免重复召回窗口内章节。
- 长程记忆激活阈值与窗口绑定：默认从第 `7` 章（`MEMORY_ACTIVATION_CHAPTER + 1`）开始触发向量补偿。
- `book_chapter_summaries` 改为增量 upsert，不再全量删除/重插，支持长篇连载的历史摘要持久化。
- 章节记忆新增 `character_states` 快照（状态/等级/情绪/位置），向量召回时可还原“当时角色状态”。
- 核心章节生成 Agent 角色窗口统一为 `UNIFIED_AGENT_MAX_CHARACTERS`（默认 `12`），并在上下文裁剪时输出截断告警日志。

## 向量检索配置说明

- 使用 `pgvector hnsw` 索引时，`llm.embedding.dimensions` 需小于等于 `2000`；建议使用 `1536`（`text-embedding-3-large` 兼容）。
- 历史 `chapter_memories.character_states` 回填脚本：
  - `cd backend && pnpm run backfill:chapter-memory-character-states`
  - 支持参数：`--bookId <uuid> --from <chapter> --to <chapter> --limit <n> --dryRun`

## Pipeline 编排与连线规则

- Pipeline 前端布局由 `frontend/apps/web/src/pages/Novel/Pipeline/topology-layout.ts` 统一计算，优先使用规则驱动，避免手工逐点修图。
- 节点排布采用三列模型（`LEFT/CENTER/RIGHT`）+ 分阶段纵向编排（`preparation/quality_loop/post_process/recording`），通过 `ROW_*` 和 `PHASE_GAP` 控制全局间距。
- 当中列 `check/condition` 节点同时接收左右两侧来源且来源中心高度接近时，自动进行中心线对齐（按 `centerY` 对齐，不按顶部对齐），减少左右入线斜率与并线错觉。
- 连线路由优先级：业务例外（如 `retry` 左侧回环、`bypass` 右侧绕行）> 双侧汇入侧向入线 > 同层横向 `side->side` > 常规 `bottom->top`。
- 主干高亮按 `source->target->type` 精确识别，避免同节点对的不同语义边（如 `conditional_true` 与 `rollback`）被错误一起加粗。
- 关键直连边（如 `det-check-loop->reviewer`、`reviewer->quality-gate`、双侧写作汇入 `det-check-loop`）使用 `straight`，其余保持 `smoothstep` 并统一弯折参数。
- 节点连接点（handle）按“实际被边使用”动态显示；未使用的 `top/left/right/bottom` 点不渲染，降低视觉噪点。
- 节点形状采用语义化规范：`agent=矩形`、`condition=菱形`、`check=六边形`、`parallel=同步条`、`loop-entry/exit=胶囊/药丸`；尺寸与句柄样式由 `frontend/apps/web/src/pages/Novel/Pipeline/node-shape-tokens.ts` 统一管理。
- 节点文本层级采用统一 token：标题/条件/描述/状态文案由 `frontend/apps/web/src/pages/Novel/Pipeline/node-text-tokens.ts` 管理，避免不同节点字号与行高漂移。
- 节点内部间距遵循 4px 基线网格，优先使用 `1/2/3/4` 等 tailwind 间距阶梯，减少 `0.5/1.5/2.5` 类碎片化间距。
- 核心节点最小高度由 `NODE_SIZE` 统一约束（布局计算与组件渲染同源），避免因内容差异导致中心线偏移。
- 条件节点出线采用固定语义方向：`conditional_true` 默认右侧出线、`conditional_false` 默认左侧出线；在跨列连接中优先保持该语义方向。
- 条件节点会在左右侧渲染语义提示（左=否、右=是），与连线方向语义保持一致。
- 每个阶段会渲染一个低对比度泳道背景（`phaseLane`），用于强化分区阅读；泳道位于节点与连线下层，不参与交互。
- 泳道左上角会渲染固定贴边标签（图标 + 阶段名），在缩放视图下可保持阶段识别能力。
- 泳道背景按阶段重要性分级：`quality_loop` 对比度更高，`recording` 更轻，提升视觉注意力分配效率。
- 同一对节点存在多条语义边时，边标签会自动进行上下错位，降低文本重叠并增强可读性。
- 主干路径边会附加低频弱高亮动画（`edge-main-flow`），用于快速识别默认执行主线；在 `prefers-reduced-motion` 下自动禁用动画。
- 主干路径边的箭头尺寸会高于普通边（约 +20%），提升缩小视图下的方向识别度。
- 非主干边透明度会进一步下调（约 `-8%`），将视觉注意力集中在主干路径，同时保留分支可读性。
