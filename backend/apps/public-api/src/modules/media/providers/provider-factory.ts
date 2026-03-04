/** Provider 工厂 — 根据 providerKey 动态创建生成器实例（补充 Registry 的静态注册） */
import { ImageProvider, VideoProvider, TtsProvider } from '../interfaces/media-provider.interface';
import { ProviderRegistryService } from './provider-registry.service';

export type ProviderCapabilityQuery = { type: 'image'; capability?: string } | { type: 'video'; capability?: string } | { type: 'tts' };

export class ProviderFactory { // 静态工厂方法，便于未来扩展 FAL/Google/OpenAI Compatible 等
  static resolveImage(registry: ProviderRegistryService, providerKey?: string, _modelId?: string): ImageProvider {
    return registry.getImageProvider(providerKey); // 当前通过 Registry 解析，后续可按 modelId 路由
  }
  static resolveVideo(registry: ProviderRegistryService, providerKey?: string): VideoProvider {
    return registry.getVideoProvider(providerKey);
  }
  static resolveTts(registry: ProviderRegistryService, providerKey?: string): TtsProvider {
    return registry.getTtsProvider(providerKey);
  }
  static findByCapability(registry: ProviderRegistryService, query: ProviderCapabilityQuery): string[] { // 按能力查询可用 provider
    return registry.listProviders()
      .filter(p => p.type === query.type && (!('capability' in query) || !query.capability || p.capabilities.has(query.capability)))
      .map(p => p.name);
  }
}
