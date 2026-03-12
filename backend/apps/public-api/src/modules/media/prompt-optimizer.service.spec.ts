import { PromptOptimizerService } from './prompt-optimizer.service';

describe('PromptOptimizerService', () => {
  it('keeps seedream provider family free from default quality boosters', () => {
    const configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key !== 'media') return {};
        return {
          defaultImageProvider: 'volcengine.doubao-seedream',
        };
      }),
    } as any;

    const service = new PromptOptimizerService(configService);
    service.onModuleInit();

    const result = service.optimizeForT2I('A cinematic portrait', '', {
      provider: 'volcengine.doubao-seedream',
    });

    expect(result.prompt.toLowerCase()).not.toContain('high quality');
    expect(result.prompt.toLowerCase()).not.toContain('detailed');
    expect(result.prompt.toLowerCase()).not.toContain('sharp focus');
  });
});
