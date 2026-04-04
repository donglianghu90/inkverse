---
name: backend-coding-standard
description: 定义了 inkverse 后端的核心架构规则、设计模式和编码标准，特别针对 NestJS 模块化单体架构、LLM 管线和 BullMQ 任务队列。
---

# 后端编码标准: inkverse

本技能文档确立了修改或扩展 `inkverse` 后端的严格编码规范。**AI 代理在 inkverse 后端生成、编辑或重构代码时，必须严格遵守以下规则。**

## 1. 架构范式

后端基于 NestJS 应用程序（主要是 `public-api`）构建，采用高级的模块驱动（Module-driven）结构。
- **框架**: NestJS (v11) 与 TypeScript。
- **数据库**: 基于 TypeORM 的 PostgreSQL。
- **队列/Worker**: BullMQ + Redis。
- **AI 工具链**: LangChain (用于 OpenAI, Anthropic, Google GenAI 等)。
- **校验**: `Zod` (用于 LLM 结构化输出/状态校验) 和 `class-validator/class-transformer` (用于 HTTP DTOs)。

### 2. 模块边界与领域驱动 (DDD) 设置
系统在 `apps/public-api/src/modules/` 目录下严格按照逻辑领域进行划分 (例如：`drama`, `novel`, `market`, `llm`)。
- **禁止循环依赖 imports**: 仅在万不得已时才依赖 NestJS 的 `forwardRef`。理想情况下，应通过事件总线或共享基础模块进行解耦。
- **桶导入 (Bucket/Barrel Exports)**: 对于复杂的目录结构 (比如短剧模块中的 `workflow`、`media-pipeline`、`agents`)，要维护桶文件 (`index.ts`)，并在模块定义中使用桶导入，以保持 `.module.ts` 文件整洁。例如：使用 `import { AgentA, AgentB } from './agents';` 而不是逐行导入。

## 3. Drama LLM 管线标准

`drama` (短剧) 模块是最复杂的业务领域，必须完全符合其最新的管线和 Prompt 架构约束：

1. **Prompt 去中心化模式**: 绝对不要使用全局的、单体化的 Prompt 模板字符串生成。每一个领域 Agent (例如 `VisualAssetDesignerAgent`, `AudioDirectorAgent`) 或 Genre 子模块必须维护其**专属的局部逻辑**来处理提示词。旧文件中的 fallback 降级逻辑应被移除，配置要紧密地与其使用场景直接耦合。
2. **极简 Schema 输出**: LLM Agent 响应的 schemas 应是**极致精简**的增量/补丁 (patch schema)。例如，如果一个 Agent 是 audio-director (音频导播)，它只能返回 `{ audio: { ... } }`。这避免了消耗大量 token，并降低无关字段被 LLM 污染而导致数据损坏的风险。
3. **结构化输出响应**: 严格使用 `Zod` 定义 LLM 的响应结构。管线执行期间发生任何 Schema 校验错误，均须进行防御性处理。

## 4. 工作流 (Workflows) 与控制器 (Controllers) 最佳实践
1. **控制器的核心职责**: 控制器 (Controllers) 应当专门负责 HTTP 请求/响应的格式化、全局拦截器的解析，以及基础的服务调用业务。禁止将复杂的业务判断塞进 `@Controller()` 注解对应的方法里。
2. **工作流拓扑结构**: 在图结构执行 (如 `DramaGraphRunEntity` 等) 过程中，应将业务逻辑抽象为依赖 `State Store`(状态仓库) 的确定性步骤。对生成链路中某一部分状态的变更，必须使用明确的状态恢复技术 (如 `drama-task-recovery.service.ts`)。
3. **日志与 SSE 推送**: SSE (Server-Sent Events) 事件推送或详细日志写入应当严格遵循各模块既定的发送标准，以保证前端 UI 可以实时跟踪生产进度。
4. **BullMQ 任务执行**: 耗时较长的重负载操作 (例如图像生成、视频转码) 必须抛给 BullMQ 队列执行 (`DRAMA_QUEUE.IMAGE`, `DRAMA_QUEUE.VIDEO`)。只能等待副作用结束状态广播，不要阻塞 HTTP 的接口响应。
5. **接口设计规范**: 放弃传统的 RESTful API 设计风格，统一且只允许使用 `GET` 和 `POST` 请求方法。禁止使用 `PUT`、`PATCH`、`DELETE` 等方法，通过明确的接口端点 (Endpoint) 或请求体进行动作表达。

## 5. 数据流与实体规范 (DTOs & Entities)
在各个模块内部，数据传输对象 (DTO) 和数据库实体 (Entities) 必须严格遵守以下高内聚原则：
1. **Entities 实体归属**: TypeORM 实体对象 (`*.entity.ts`) 应当存放在**直接管理它的业务层模块**对应的 `entities/` 目录。实体必须归属于语义对应的业务模块（例如：模板数据模型归属于 `template/entities/` 模块，即便是 `drama` 的脚本在引用它）。严禁为了贪首图方便，将依赖的其他模块实体文件堆砌在调用方的目录下。
2. **DTO 校验隔离**: `dto/` 目录下存放的 `*.dto.ts` 文件专用于网络请求和数据传输。它们必须利用 `class-validator` 和 `class-transformer` 实现高强度的入参及格式验证，**严禁**在 DTO 中夹杂任何业务层处理逻辑或数据库处理逻辑。

## 6. 数据库操作规范 (Database Operations)
强制使用 TypeORM 的对象化查询语法 (Object Literal Syntax) 处理绝大多数数据库操作，例如：
```typescript
return this.repo.find({ where: { userId }, order: { displayName: 'ASC' } });
```
**严禁**随意使用直接的 `query()` 原生 SQL 语句 或 `QueryBuilder` 进行简单查询。只有在面临极端复杂的多表联查或统计（如聚合函数导致 Object API 完全无法支持）时，才允许降级使用。请尽量保持数据操作代码的高可读性和强类型安全。

## 7. 文件命名规范
- `*.module.ts`: 各个根节点或特性模块的配置。
- `*.controller.ts`: 用于处理路由入口端点配置。
- `*.service.ts`: 核心的单例执行业务逻辑、工具包或工作流管线。
- `*.agent.ts`: 封装特定角色或工作流节点步骤的领域 LLM 代理 (Agents)。
- `*.processor.ts`: 专门负责消费处理 BullMQ 队列任务的 Worker 进程。
- `*.entity.ts`: 基于 TypeORM 的 PostgreSQL 数据库实体类。
- `*.mjs`: 构建时或离线的单文件执行脚本 (千万不要误认为其为运行时业务层代码)。

## 8. 开发环境避坑指南
- **TypeORM / Zod 中的 Null 或 Undefined 陷阱**: 确保嵌套生成的 schema 能正确包容 `null` / `optional` 边界值处理，特别是涉及来自外界配置的参数（例如 `intensity` 或类似配置项）。
- **环境变量**: 对所有的环境变量和系统属性的处理统一交接给 `ConfigService` (实际从 `public.properties` 提取属性)。
- **绝对路径 VS 相对路径**: 内部直接引入本地层模块尽量顺从于相对路径调用风格 (`./`, `../`)。如已定义别名 (`@packages/common`) 则一律优先调用包名。

## Agent 行为要求：
在修改任何相关代码前，永远要首发确认此举项是否打破原有的特性模块作用域。在调试并实装 LLM Prompt 工程逻辑时，必须通过测试复核检验是否违反空间一致性原理、角色身份锚点要求以及高质量出图画质规则。
