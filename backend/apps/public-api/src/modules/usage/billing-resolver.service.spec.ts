import { BillingResolverService } from './billing-resolver.service';

describe('BillingResolverService', () => {
  it('parses string rates from properties config and supports vendor fallback', () => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'media.cost') {
          return {
            image: {
              'volcengine.doubao-seedream': '0.08',
              volcengine: {
                default: '0.05',
                'doubao-seedream-4-0-250828': '0.03',
                'doubao-seedream-5-0-260128': {
                  default: '0.06',
                  '9:16': '0.07',
                  '16:9': '0.065',
                  '2K': '0.09',
                },
              },
            },
            video: { volcengine: '0.6' },
            tts: { volcengine: { default: '0.02' } },
          };
        }
        if (key === 'llm.embedding') return { costPer1MTokens: '1.23' };
        return {};
      }),
    } as any;

    const resolver = new BillingResolverService(config);
    expect(resolver.resolveImageCostCny('volcengine.doubao-seedream')).toBe(0.08);
    expect(resolver.resolveImageCostCny('volcengine.doubao-seedream', 'doubao-seedream-4-0-250828')).toBe(0.08);
    expect(resolver.resolveImageCostCny('volcengine.other-family', 'doubao-seedream-4-0-250828')).toBe(0.03);
    expect(resolver.resolveImageCostCny('volcengine.other-family', 'doubao-seedream-5-0-260128', '9:16')).toBe(0.07);
    expect(resolver.resolveImageCostCny('volcengine.other-family', 'doubao-seedream-5-0-260128', '3:2')).toBe(0.06);
    expect(resolver.resolveImageCostCny('volcengine.other-family', 'doubao-seedream-5-0-260128', '2k')).toBe(0.09);
    expect(resolver.resolveVideoCostCny('volcengine.seedance')).toBe(0.6);
    expect(resolver.resolveTtsCostCny('volcengine.voice')).toBe(0.02);
    expect(resolver.resolveEmbeddingCostCny(1_000_000)).toBe(1.23);
  });

  it('throws on invalid billing number to fail fast at startup', () => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'media.cost') return { image: { volcengine: 'abc' } };
        if (key === 'llm.embedding') return {};
        return {};
      }),
    } as any;

    expect(() => new BillingResolverService(config)).toThrow('Invalid billing config');
  });
});
