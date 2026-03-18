import { ProviderRegistryService } from './provider-registry.service';

describe('ProviderRegistryService', () => {
  it('maps legacy image provider alias "volcengine" to canonical vendor.family provider', () => {
    const configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key !== 'media') return {};
        return {
          defaultImageProvider: 'volcengine',
          defaultVideoProvider: 'volcengine',
          volcengine: {
            apiKey: 'test-api-key',
            image: {
              model: 'doubao-seedream-5-0-260128',
              models: 'doubao-seedream-5-0-260128,doubao-seedream-4-5-251128',
              defaultSize: '1:1',
              defaultResolution: '2K',
            },
            video: { enabled: false },
            tts: {},
          },
        };
      }),
    } as any;

    const kieAiCallbackService = {} as any;
    const kieAiPollingService = {} as any;
    const registry = new ProviderRegistryService(configService, kieAiCallbackService, kieAiPollingService);
    registry.onModuleInit();

    expect(registry.getImageProvider().name).toBe('volcengine');
    expect(registry.getImageProvider('volcengine').name).toBe('volcengine');
  });
});
