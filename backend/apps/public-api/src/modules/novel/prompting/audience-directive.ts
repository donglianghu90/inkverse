import { StoryState } from '../schemas/novel-state.schemas';

const FOCUS_LABEL: Record<string, string> = {
  female_lead: '女主视角优先',
  male_lead: '男主视角优先',
  dual_lead: '双主角平衡推进',
  ensemble: '群像叙事',
};

export function buildAudiencePromptBlock(state: StoryState): string {
  if (!state.seed) return '';
  const directive = state.audienceDirective;
  const audienceTags = directive?.audienceTags?.length ? directive.audienceTags : (state.seed?.audienceTags ?? []);
  const lines: string[] = [
    '=== 受众策略（新建书全链路约束）===',
    `目标读者：${state.seed?.targetAudience ?? '未知'}`,
  ];
  if (audienceTags.length) lines.push(`受众标签：${audienceTags.join('、')}`);
  if (directive?.protagonistFocus || state.seed.protagonistFocus) {
    const focus = directive?.protagonistFocus ?? state.seed.protagonistFocus!;
    lines.push(`主角叙事：${FOCUS_LABEL[focus] ?? focus}`);
  }
  if (directive?.tonePreference || state.seed.tonePreference) {
    lines.push(`调性偏好：${directive?.tonePreference || state.seed.tonePreference}`);
  }
  if (directive?.relationshipDensity) {
    lines.push(`关系线密度：${directive.relationshipDensity}`);
  }
  if (directive?.hardConstraints?.length) {
    lines.push(`硬约束（不可破）：${directive.hardConstraints.join('；')}`);
  }
  if (directive?.softPreferences?.length) {
    lines.push(`软偏好（尽量满足）：${directive.softPreferences.join('；')}`);
  }
  lines.push('题材规则优先于受众偏好；受众偏好用于同题材内风格调优，禁止写偏题材。');
  return lines.join('\n');
}
