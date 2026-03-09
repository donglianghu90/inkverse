/** 音频资源 — 契约 */

export interface AudioSegment {
  url: string;
  durationSec?: number;
  label: string;
}
