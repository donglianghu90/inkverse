/** 将 drama_global_prompt_settings 从 12 个集内容 Agent 切换到 5 个创建准备 Agent */
import { MigrationInterface, QueryRunner } from 'typeorm';

const OLD_EPISODE_AGENT_TYPES = [
  'arc-director', 'episode-director', 'continuity-guard', 'scriptwriter',
  'dialogue-coach', 'storyboard-director', 'audio-director',
  'script-reviewer', 'script-editor', 'pacing-analyzer', 'hook-crafter', 'episode-recorder',
];

const NEW_CREATION_AGENT_TYPES = [
  'seed-analyzer', 'series-director', 'visual-asset-designer', 'drama-profiler', 'drama-strategy',
];

export class UpdateGlobalPromptAgentTypes202603180003 implements MigrationInterface {
  name = 'UpdateGlobalPromptAgentTypes202603180003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 删除旧的集内容 Agent 行（system 和所有用户）
    if (OLD_EPISODE_AGENT_TYPES.length) {
      const placeholders = OLD_EPISODE_AGENT_TYPES.map((_, i) => `$${i + 1}`).join(', ');
      await queryRunner.query(
        `DELETE FROM drama_global_prompt_settings WHERE agent_type IN (${placeholders})`,
        OLD_EPISODE_AGENT_TYPES,
      );
    }

    // 为 system 用户插入新的 5 个创建 Agent 默认行（如不存在）
    const descriptions: Record<string, string> = {
      'seed-analyzer': '创意分析 — 从用户创意中提取短剧种子与策略方向',
      'series-director': '总导演 — 分段式全剧大纲规划（付费卡点/情绪节奏）',
      'visual-asset-designer': '视觉资产设计 — 角色/场景/视觉风格初始设计',
      'drama-profiler': '编剧手册 — 生成指导所有 Agent 的风格/规则/审核维度',
      'drama-strategy': '策略师 — 制定付费卡点策略、前3集钩子、角色预算',
    };
    for (const agentType of NEW_CREATION_AGENT_TYPES) {
      await queryRunner.query(
        `INSERT INTO drama_global_prompt_settings (user_id, agent_type, global_additional_prompt, description, updated_at)
         VALUES ('system', $1, '', $2, now())
         ON CONFLICT (user_id, agent_type) DO NOTHING`,
        [agentType, descriptions[agentType] ?? agentType],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 删除新增的 5 个创建 Agent 行
    const placeholders = NEW_CREATION_AGENT_TYPES.map((_, i) => `$${i + 1}`).join(', ');
    await queryRunner.query(
      `DELETE FROM drama_global_prompt_settings WHERE agent_type IN (${placeholders})`,
      NEW_CREATION_AGENT_TYPES,
    );
  }
}
