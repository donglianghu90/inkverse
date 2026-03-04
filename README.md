# inkverse

inkverse 是一个基于大语言模型（LLM）的 AI 创作引擎，支持**小说**和**短剧**两种创作模式——从故事构思到成品的完整生成流程。

## 短剧引擎（Drama Module）

独立于小说模块的短剧生成引擎，从创意到逐镜头 Shot JSON 的完整链路。

### 创建流程（6步）
`SeedAnalyzer` → `SeriesDirector`（全剧大纲+分集概要+付费卡点） → `VisualAssetDesigner`（角色锁脸+配音+场景+风格指南+**角色变体衣橱**） → **参考图生成**（T2I 角色定妆照+场景图+**变体参考图**，以base图为参考保持面部一致） → `DramaProfiler`（编剧手册） → `DramaStrategy`（付费/悬念/角色预算策略）

### 逐集生成 Pipeline（13步，支持断点续跑+可配置参数）
`ArcDirector`（段落规划） → `EpisodeDirector`（集级意图） → `ContinuityGuard`（连续性预检，**阻断性问题自动回退EpisodeDirector重试**） → `Scriptwriter`（剧本） → `DialogueCoach`（台词润色，可关闭） → `StoryboardDirector`（**按场景分步生成**Shot+首尾帧提示词） → `AudioDirector`（BGM/SFX/环境音/TTS标注） → `DeterministicChecker`（硬规则阻断/软规则警告） → `ScriptReviewer`（质量审核） → `ScriptEditor`（**定向精修**，传入critical issues，轮数可配） → `PacingAnalyzer`（节奏分析，可关闭） → `HookCrafter`（集末悬念+下集预告，可关闭） → `EpisodeRecorder`（知识记录+闪回标注）

- **断点续跑**：逐集和创建流程（6步）每步完成后写入checkpoint，中断后自动从上次中断处恢复，跳过已完成步骤，节省LLM调用
- **启动恢复**：服务重启时自动扫描超过5分钟仍处于 `running` 的创建流程，有checkpoint数据的尝试恢复，无数据的标记失败
- **WorkflowParams可配置**：精修轮数(`maxEditRounds`)、连续性重试次数(`maxContinuityRetries`)、质量通过分数(`qualityPassScore`)、台词润色/节奏分析/悬念设计开关均通过 Pipeline 配置动态读取

### Pipeline 编排配置（DramaAgentPipelineEntity）
- **节点可配置**：13个Agent节点支持启用/禁用/重排序，6个核心节点（ArcDirector/EpisodeDirector/Scriptwriter/StoryboardDirector/DeterministicChecker/EpisodeRecorder）不可删除
- **草稿/发布模式**：`draftNodes` 支持自由编辑，`publish` 后生效到 `publishedNodes`，逐集Pipeline读取发布版本
- **WorkflowParams**：`maxEditRounds`(精修轮数,默认2)、`maxContinuityRetries`(连续性重试,默认1)、`qualityPassScore`(质量阈值,默认7.0)、`enableDialogueCoach/PacingAnalyzer/HookCrafter`(可选节点开关,默认true)
- **拓扑可视化**：4阶段（准备→编剧→制作→后期）线性链拓扑，含条件分支（精修判断门）和重试回环，支持前端ReactFlow渲染

### Prompt 集中管理（Drama Playbook）
- **drama-playbook.ts**：17个Agent的System Prompt集中管理为builder函数，运行时参数化，支持统一修改和A/B测试
- **DramaPromptTemplateService**：从Pipeline配置读取`additionalSystemPrompt`叠加到Playbook基础prompt上，实现per-agent的prompt微调
- 创建阶段5个Agent（SeedAnalyzer/SeriesDirector/VisualDesigner/Profiler/Strategy）直接使用Playbook函数
- 逐集阶段12个Agent通过PromptTemplateService组合Playbook+Pipeline自定义追加

### 数据模型
- `DramaState`：顶层聚合，包含 seed/outline/characters/locations/visualStyle/strategy/promptProfile/secretLedger/flashbackBank 等
- `CharacterIdentity`：角色身份，含 faceDescription/faceReferencePrompt/voiceProfile/defaultCostume/**variations**（外观变体列表：换装/受伤/伪装等）
- `Shot`：最小粒度，含 camera/characters/dialogue/audio/visualPrompt（英文20-50词）/subtitle/duration/transition/firstFramePrompt/lastFramePrompt（**首尾帧关键帧插值提示词**）/firstFrameImageUrl/**lastFrameImageUrl**/**characterVariationIds**（角色变体选择映射）
- `EpisodeLoreRecord`：知识记录，含 characterStateDeltas/plotAdvances/newSecrets/flashbackCandidates

### 题材模板系统
- 10 个系统预置短剧题材模板：霸总/甜宠/战神/穿越/宫斗/复仇/重生/悬疑/都市/古装
- 每个模板包含：`seedHints`（爽点预设/冲突模式/付费策略/视觉风格/台词风格）、`audienceTags`、`protagonistFocusTags`、`toneTags`、`platformTags`
- 用户可自定义题材模板（CRUD + 克隆），系统模板自动同步
- `DramaGenreTemplateEntity` 持久化于 `drama_genre_templates` 表，字段设计参考小说模板但更轻量

### 逐集媒体生成流水线（MediaOrchestrator）
文本 Pipeline 完成后，可手动触发完整单集媒体生成（四阶段流水线，**并发优化**）：
1. **Phase 0 — T2I 首帧+尾帧图片生成**（可通过 `media.pipeline.skipImageGeneration=true` 跳过）
   - **并发池**：同时最多 3 个 T2I 请求（`T2I_CONCURRENCY=3`），大幅缩短生成时间
   - 每个 Shot 生成首帧（`firstFramePrompt`）和尾帧（`lastFramePrompt`）两张图片
   - **动态参考图权重**：特写镜头增大角色参考图权重(0.6)，全景镜头增大场景权重(0.4)
   - **角色变体支持**：Shot 可通过 `characterVariationIds` 指定使用角色变体参考图
   - **前帧参考**：上一 Shot 的生成图作为下一 Shot 的弱参考(weight=0.15)，保持镜头间视觉连贯
   - 场景去重：同 `sceneId` 共享场景背景参考图
2. **Phase 1 — I2V/T2V 视频生成（关键帧插值）**
   - **并发提交**：同时最多 2 个视频任务（`I2V_CONCURRENCY=2`）
   - **关键帧插值模式**：首帧图作为 `first_frame`、尾帧图作为 `last_frame` 传入，起止画面均可控
   - 角色参考图：出场角色定妆照（或变体图）作为 `character` 参考
   - 闪回精确复用 + 预览跳过
   - **事件驱动等待**：监听 `MediaJobService` 的 `completed` 事件，30分钟超时
3. **Phase 2 — TTS 语音合成**：逐 Shot 为有对白的镜头生成语音
   - 角色音色匹配 + 情感/语速控制
   - Provider: 火山引擎 openspeech（豆包 TTS），未配置时自动跳过
4. **Phase 3 — FFmpeg 视频合成**：拼接所有 Shot 视频 + TTS + BGM + SFX + 字幕
- **Shot级重试**：T2I首帧/尾帧和I2V视频生成支持指数退避自动重试（最多2次，2s→4s），重试全部失败后仍走降级路径
- **断点续传**：`shotMediaMap` 中已 `completed` 的 Shot 会被跳过
- **任务恢复**：服务重启时自动扫描未完成的媒体任务

### 任务队列系统（BullMQ）
- **四队列分治**：`drama:text`（文本/LLM任务，并发3）、`drama:image`（图片生成，并发5）、`drama:video`（视频生成，并发2）、`drama:voice`（语音合成，并发5）
- **分布式替代内存锁**：替代原 `Set<string>` 内存并发控制，服务重启不丢任务，支持横向扩展
- **任务生命周期**：`withTaskLifecycle` 统一包装 Worker 执行，含心跳检测（10秒）、乐观锁状态流转、错误归一化、自动重试决策
- **指数退避重试**：`BullMQ backoff: exponential(2000ms)`，可配 `maxAttempts`，错误归一化后自动判断 `retryable`
- **去重（幂等）**：`dedupeKey` 唯一约束，同一任务不会重复入队
- **僵死检测**：`DramaTaskService.findStuckTasks()` 检测心跳超时的 processing 任务
- **任务提交**：`TaskSubmitterService.submit()` 一站式创建记录+入队

### 步骤级事件追踪（Graph Run/Step/Event）
- **三表设计**：`drama_graph_runs`（Run根对象）、`drama_graph_steps`（步骤投影）、`drama_graph_events`（事件日志）
- **有序事件**：事务内 `lastSeq` 单调递增，保证事件有序不重不漏
- **增量回放**：`GET /api/drama/:dramaId/runs/:runId/events?afterSeq=N` 支持断线重连后补拉事件
- **事件类型**：`run.start / step.start / step.chunk / step.complete / step.error / run.complete / run.error / run.canceled`
- **投影同步**：事件追加时同事务内更新 Run/Step 投影状态，保证一致性

### 统一错误归一化
- **16 种错误码**：client类（INVALID_PARAMS/NOT_FOUND/UNAUTHORIZED/FORBIDDEN/CONFLICT）、provider类（RATE_LIMIT/GENERATION_FAILED/GENERATION_TIMEOUT/SENSITIVE_CONTENT/EXTERNAL_ERROR/NETWORK_ERROR）、system类（INTERNAL_ERROR/DB_ERROR/QUEUE_ERROR/TASK_TERMINATED/OWNERSHIP_LOST）、billing类（INSUFFICIENT_BALANCE/BILLING_FAILED）
- **多策略推断**：已知错误码直通→HTTP状态码映射→消息关键词推断→上下文降级
- **每个错误**包含：`code/message/httpStatus/retryable/category/details/provider`
- Worker 据此自动判断是否重试，前端据此展示分类错误信息

### 计费系统（冻结→结算→回滚）
- **三阶段事务**：预冻结（`freeze`）→执行→成功结算（`settle`）/失败回滚（`rollback`）
- **三种模式**：`OFF`（不计费，默认）、`SHADOW`（记录不扣费）、`ENFORCE`（强制扣费）
- **悲观锁保证**：余额操作使用 `pessimistic_write` 锁，并发安全
- **幂等冻结**：`idempotencyKey` 唯一约束防重复冻结
- **精确结算**：实际扣费不超过冻结额，差额自动退还
- 实体：`drama_user_balances`（余额）、`drama_balance_freezes`（冻结记录）、`drama_balance_transactions`（流水）

### 全局资产中心（Asset Hub）
- **跨剧复用**：角色/场景/风格模板从单剧绑定升级为全局资产库
- **实体**：`drama_global_asset_folders`（文件夹）、`drama_global_characters`（角色）、`drama_global_locations`（场景）、`drama_global_styles`（风格）
- **双向同步**：`copyCharacterToDrama()`（全局→剧集）、`extractFromDrama()`（剧集→全局），资产溯源通过 `sourceGlobalCharacterId` 追踪
- **文件夹管理**：一层扁平目录，按用户隔离

### Orchestrator 纯函数编排
- **核心逻辑与 IO 解耦**：`creation-orchestrator.ts` 和 `episode-orchestrator.ts` 为纯函数，通过 `runStep` 回调注入 LLM 执行
- **Agent 退化为薄包装**：各 Agent 仅负责组装 prompt + 调用 Orchestrator，不再承担编排逻辑
- **内置重试**：`runWithRetry()` 指数退避 + 可配重试次数，JSON 解析容错
- **并行优化**：编剧手册和策略生成并行执行
- **可测试性**：纯函数可直接单元测试，mock `runStep` 即可

### SSE 实时进度
- **创建阶段**：`GET /api/drama/:dramaId/create-sse` — 订阅 6 步创建流程进度（种子分析→大纲→视觉设计→参考图生成→编剧手册+策略→完成）
- **逐集生成**：`GET /api/drama/:dramaId/episodes/generate-sse?count=N` — 触发生成并推送 13 步 Pipeline 进度，完成后返回结果
- **媒体生成**：`GET /api/drama/:dramaId/episodes/:episodeNumber/generate-media-sse` — 触发单集媒体生成并推送 `phase: 'media'` 进度，完成后返回结果
- **纯监听**：`GET /api/drama/:dramaId/episodes/progress-sse` — 只监听不触发，用于多端观察
- `DramaProgressService`：EventEmitter 驱动，支持 `create`/`episode`/`media` 三种 phase，15 秒心跳保活
- **增量回放**：结合 `DramaRunService.getEventsSince()` 支持断线后补拉持久化事件，不再依赖纯内存 SSE
- 前端 CreateDrama 页面在第 5 步展示实时进度条和步骤状态
- 前端 DramaWorkbench 生成时展示进度条和当前步骤

### API 端点
- `POST /api/drama` — 创建短剧（触发5步创建流程）
- `GET /api/drama` — 列表
- `GET /api/drama/:dramaId` — 详情（含完整 DramaState）
- `POST /api/drama/:dramaId/episodes/generate?count=N` — 异步启动N集生成（立即返回，后台执行）
- `GET /api/drama/:dramaId/episodes` — 分集列表
- `GET /api/drama/:dramaId/episodes/:episodeNumber` — 集详情（含 script/storyboard/review/loreRecord）
- `GET /api/drama/:dramaId/visual-assets` — 视觉资产（含 referenceImageUrl）
- `POST /api/drama/:dramaId/visual-assets/:assetId/regenerate` — 重新生成参考图
- `POST /api/drama/:dramaId/episodes/:episodeNumber/generate-media` — 触发单集 Shot 视频生成
- `GET /api/drama/:dramaId/episodes/:episodeNumber/media-status` — 查询单集媒体生成进度
- `GET /api/drama/:dramaId/create-sse` — 创建进度 SSE
- `GET /api/drama/:dramaId/episodes/generate-sse?count=N` — 生成进度 SSE
- `GET /api/drama/:dramaId/episodes/:episodeNumber/generate-media-sse` — 媒体生成进度 SSE（触发+推送）
- `GET /api/drama/:dramaId/episodes/progress-sse` — 纯监听进度 SSE
- `GET /api/drama/:dramaId/pipeline` — 获取Pipeline配置（含草稿/发布节点+WorkflowParams）
- `PUT /api/drama/:dramaId/pipeline/draft` — 保存Pipeline草稿（body: `{ nodes: [...] }`）
- `POST /api/drama/:dramaId/pipeline/publish` — 发布Pipeline草稿到生效版本
- `PUT /api/drama/:dramaId/pipeline/params` — 更新WorkflowParams（body: Partial<DramaWorkflowParams>）
- `GET /api/drama/:dramaId/pipeline/topology` — 获取Pipeline拓扑（phases/nodes/edges/params，用于前端可视化）
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

## 媒体生成模块（Media Module）

独立的多 Provider 媒体生成框架，支持图片生成（T2I/I2I）和视频生成（T2V/I2V），架构设计为可插拔的策略模式，更换 Provider 只需实现接口 + 改配置。

### 架构设计
- **策略模式 + Provider 注册表**：`ProviderRegistryService` 在启动时根据配置自动初始化并注册所有可用 Provider，业务层通过 `MediaService` 门面调用，完全不感知底层实现
- **Provider 工厂 + 能力查询**：`ProviderFactory` 按 providerKey/modelId 动态解析，`findByCapability()` 查询具备指定能力的 Provider 列表（如支持 `i2v` 的视频 Provider）
- **配置驱动切换**：`media.defaultImageProvider` / `media.defaultVideoProvider` 控制默认 Provider，无需改代码
- **异步任务轮询**：视频生成为异步任务（提交→轮询），`MediaJobService` 自动轮询（8秒间隔），结果持久化至 `media_jobs` 表，支持断线续查
- **事件驱动**：任务完成时通过 `EventEmitter` 发出 `completed` 事件，`MediaOrchestrator` 监听事件而非自身轮询
- **本地持久化存储**：`LocalStorageService` 管理 `storage/` 目录（images/videos/audio/tmp），所有媒体产出物写入持久化目录

### 当前 Provider
| 能力 | Provider | 平台 | 说明 |
|------|----------|------|------|
| T2I | Seedream | 火山方舟 | 文生图/图生图/多图融合，角色定妆照+场景参考图 |
| T2V | Seedance | 火山方舟 | 文生视频/图生视频，支持参考图锁脸 |
| TTS | 豆包 TTS | openspeech.bytedance.com | 多音色语音合成，支持情感/语速控制 |
- 统一鉴权 + 自动重试（HTTP 客户端层 `VolcengineClient`）

### 音频资源库（BGM/SFX/Ambience）
- `AudioResourceService`：语义标签→音频文件URL映射，支持 BGM（10 mood）、SFX（12 sound）、Ambience（8 场景）
- 支持自定义映射：`assets/audio/mapping.json` 覆盖/扩展默认映射
- 支持 OSS 远程 URL 或本地文件路径

### FFmpeg 视频合成（VideoComposerService）
- 5 步合成流程：下载远程视频→concat 拼接→TTS 音频混入→BGM 混音→ASS 字幕烧录
- 需要系统安装 FFmpeg（`brew install ffmpeg`），未安装时自动跳过合成步骤

### 扩展新 Provider（示例：接入 Kling）
1. 创建 `providers/kling/kling-video.provider.ts`，实现 `VideoProvider` 接口
2. 在 `ProviderRegistryService.onModuleInit()` 中添加 `initKling()` 初始化逻辑
3. 配置 `media.kling.apiKey` 等参数，`media.defaultVideoProvider = kling`

### 配置项（`backend/config/public.properties`）
| 配置键 | 说明 | 默认值 |
|--------|------|--------|
| `media.volcengine.apiKey` | 方舟 API Key | — |
| `media.volcengine.baseUrl` | API 基础地址 | `https://ark.cn-beijing.volces.com/api/v3` |
| `media.volcengine.image.model` | Seedream 模型名 | `seedream-5-0-lite-250901` |
| `media.volcengine.image.defaultSize` | 默认图片尺寸 | `1024x1024` |
| `media.volcengine.video.model` | Seedance 模型名 | `seedance-2-0-250901` |
| `media.volcengine.video.defaultDuration` | 默认视频时长(秒) | `5` |
| `media.volcengine.video.defaultQuality` | 默认视频质量 | `720p` |
| `media.volcengine.tts.appId` | 豆包 TTS 应用 ID | — |
| `media.volcengine.tts.token` | 豆包 TTS 访问令牌 | — |
| `media.volcengine.tts.cluster` | TTS 集群 | `volcano_tts` |
| `media.volcengine.tts.defaultVoiceType` | 默认音色 | `zh_female_cancan_mars_bigtts` |
| `media.audio.baseUrl` | 音频资源 OSS 前缀 | — |
| `media.audio.baseDir` | 音频资源本地目录 | `./assets/audio` |
| `media.defaultImageProvider` | 默认图片 Provider | `volcengine` |
| `media.defaultVideoProvider` | 默认视频 Provider | `volcengine` |
| `media.defaultTtsProvider` | 默认 TTS Provider | `volcengine` |
| `media.storage.baseDir` | 媒体持久化存储根目录 | `./storage` |
| `media.pipeline.skipImageGeneration` | 跳过 T2I 首帧图生成 | `false` |

### API 端点
- `GET /api/media/providers` — 查看已注册的 Provider 列表
- `POST /api/media/image/generate` — 生成图片（同步返回）
- `POST /api/media/video/submit` — 提交视频生成任务（异步）
- `GET /api/media/video/:jobId` — 查询视频任务状态
- `DELETE /api/media/video/:jobId` — 取消视频任务
- `GET /api/media/jobs?dramaId=xxx` — 查询某短剧关联的所有媒体任务

## 写作与生成优化

- **潜台词与感官锚定 (Subtext & Sensory Anchors)**：在场景规划阶段，强制引入潜台词约束和具体感官细节（如"生锈的铁腥味"），逼迫AI践行 *Show, Don't Tell*，消除AI味。
- **事前角色声音锚定 (Proactive Voice Anchoring)**：在生成意图时，动态提取核心出场角色的标志性台词/口癖作为生成参考，避免角色声音漂移。
- **场景过渡平滑 (Scene Transition Smoothing)**：在编辑精修阶段，增加专门针对场景切换的审查指令，确保视角转移和情绪延续如丝般顺滑。
- **伏笔唤醒期 (Foreshadowing Reminder Phase)**：在计划回收伏笔的前 1-3 章，通过卷级导演下发指令，安排微弱的视觉或记忆唤醒，为正式回收做心理铺垫。
- **并发场景生成 (Parallel Scene Generation)**：在章节工作流中，识别并并发生成平行视角（Parallel POV）的场景，大幅提升单章生成速度。
- **命名哲学与阶段激活 (Naming Philosophy & Stage Activation)**：开书阶段按题材生成 `namingConvention` 与主角 `nameGrowthArc`；每章仅注入轻量命名风格约束，主角名字的象征重量仅在卷级 `entry/climax` 阶段低频激活，避免过度提示影响写作自然度。

## 双层自迭代校准系统

引擎具备章节级 + 题材级两层自学习闭环，实现"写得越多、越写越好"。

### 第一层：章节级自校准（ChapterCalibrationService）
每章完成审阅后自动执行四条路径：
- **路径A 重复问题→规则**：`recentIssuePatterns` 追踪近期 moderate/critical 问题，同一模式出现≥2次自动生成 `auto_calibration` RuleAtom，注入 creative-writer/reviewer
- **路径B 维度偏移→权重微调**：滑动窗口（默认5章）检测评审维度均分，低于阈值时自动上调 `reviewerCalibration.dimensionWeights` 对应维度权重
- **路径C 新套话→clichePatterns**：`ai_smell` 类问题自动录入 `bookPromptProfile.clichePatterns`，后续审阅自动检测
- **过期清理**：超过 `autoRuleExpiryChapters`（默认30章）的自动规则自动移除，避免规则膨胀

### 第二层：题材模板进化（GenreCalibrationService）
弧结束时触发，跨同题材多本书聚合反哺系统级 `GenreProfileTemplate`：
- **高频规则提升**：多本书（≥3）共同验证的 `auto_calibration` 规则升格为题材模板默认规则
- **维度权重融合**：聚合同题材所有书的校准后权重，保守融合（60%原值+40%聚合值）到模板
- **套话模式共享**：多本书共同发现的 AI 味模式同步到题材模板 `clichePatterns`

### Lesson 升格机制
弧结束的回顾学习后，`strong` 级 WritingLesson 自动升格为永久 `lesson_promoted` RuleAtom，不再作为临时 lesson 重复注入。

### 短剧集级自校准（DramaCalibrationService）
短剧引擎复用相同校准配置（`calibration.*`），每集完成审阅后自动执行：
- **问题模式追踪**：`DramaState.recentIssuePatterns` 追踪 moderate/critical 级 issue，按 `category:description` 签名去重累计
- **维度权重微调**：当某维度评分低于 `dimensionShiftThreshold` 且窗口内未调整过，自动上调 `reviewerCalibration.dimensionWeights` 对应权重
- **校准提示注入**：`scriptwriter`/`episode-director`/`script-reviewer` 三个核心 Agent 注入高频问题警示，引导创作和审阅重点关注
- **滑动窗口裁剪**：活跃模式保留上限 `maxActivePatterns`（默认20），按出现频次排序

### 配置项（`backend/config/public.properties`）
| 配置键 | 说明 | 默认值 |
|--------|------|--------|
| `calibration.issueRepeatThreshold` | 问题重复几次触发规则生成 | `2` |
| `calibration.maxActivePatterns` | 活跃问题模式最大保留条数 | `20` |
| `calibration.autoRuleExpiryChapters` | 自动规则过期章数 | `30` |
| `calibration.dimensionShiftWindow` | 维度偏移检测窗口 | `5` |
| `calibration.dimensionShiftThreshold` | 维度均分低于此值触发微调 | `1.5` |
| `calibration.weightAdjustStep` | 单次权重微调步长 | `0.1` |
| `calibration.lessonPromoteMinConfidence` | Lesson 升格所需最低置信度 | `strong` |
| `calibration.genreAggregateMinBooks` | 题材聚合最低书籍数 | `3` |

### 日志与追踪
- 校准事件通过 `persistArtifact('calibration_events', ...)` 持久化，可在 artifact 中回溯每章的校准操作
- 所有校准操作通过 `Logger` 输出结构化日志，包括规则生成/权重微调/过期清理/Lesson升格/题材进化

## 章型规则动态注入（新）

- 章节工作流在编译规则前统一章型口径：`setup/escalation/twist/climax/aftermath/transition` 会映射到标准章型 `setup/rising/climax/relief/...`。
- 新增章型专属规则键：
  - `CHAPTER_TYPE_WRITING_PLAYBOOK`（写作层）
  - `CHAPTER_TYPE_SCENE_PLAN_PLAYBOOK`（场景规划层）
  - `CHAPTER_TYPE_SCENE_PURPOSE_PLAYBOOK`（场景 purpose 组合层）
  - `CHAPTER_TYPE_INTENT_PLAYBOOK`（意图层）
  - `CHAPTER_TYPE_REVIEWER_PLAYBOOK`（审阅层）
- `scene-planner` 不再整包注入所有章型的场景数量指南，而是仅注入“当前章型”；例如 `setup` 章只看到 `setup` 规则。
- `creative-writer` 优先使用 `CHAPTER_TYPE_WRITING_PLAYBOOK`，仅在缺失时回退到 `chapterTypeTemplates`，减少跨章型规则污染。
- 章节运行时会记录每个 agent 的规则编译结果（章型上下文、命中 `ruleAtom` ID、输出键），用于在 trace 中排查是否串包。

### Dry-run 验证清单（防串包）

1) 先跑一章真实生成（建议 `setup` 章）并产生日志。  
2) 在 trace 中检索以下事件：  
   - `rule-compile:chapter-intent`  
   - `rule-compile:scene-planner`  
   - `rule-compile:creative-writer`  
   - `rule-compile:chapter-reviewer`  
3) 对每条 `rule-compile:*` 检查：  
   - `meta.context.chapterType` 是否等于本章目标章型（如 `setup`）。  
   - `meta.outputKeys` 是否包含对应章型键（如 `CHAPTER_TYPE_*_PLAYBOOK`）。  
   - `meta.matchedRuleAtomIds` 是否只命中当前章型 + 通用兜底规则（不应出现其他章型专属 atom）。  
4) 若发现 `setup` 章命中了 `rising/climax` 专属 atom，说明仍有串包，需要回查该 agent 的 compile context 与条件规则。  
5) 无 beat 的章节应看到 `chapterType=general`，并命中 `general` 兜底 atom（而不是空规则）。

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
