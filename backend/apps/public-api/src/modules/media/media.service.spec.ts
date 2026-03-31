import { EventEmitter } from 'events';
import { MediaService } from './media.service';

describe('MediaService usage recording', () => {
  it('records video completion with idempotency key and novel resource mapping', async () => {
    const events = new EventEmitter();
    const registry = {} as any;
    const jobService = {
      events,
      findById: jest.fn().mockResolvedValue({
        id: 'job-1',
        jobType: 'video',
        provider: 'volcengine.seedance',
        dramaId: null,
        bookId: 'book-1',
        episodeNumber: null,
        chapterNumber: 3,
        assetType: 'chapter_video',
        refId: 'ch3',
        request: { quality: '720p' },
        userId: 'user-1',
        durationMs: 8000,
      }),
    } as any;
    const traceLogger = {} as any;
    const usageLedger = { record: jest.fn().mockResolvedValue(null) } as any;
    const billingResolver = { resolveVideoCostCny: jest.fn().mockReturnValue(0.5) } as any;
    const configService = {} as any;

    const service = new MediaService(
      registry,
      jobService,
      traceLogger,
      usageLedger,
      billingResolver,
      configService,
    );

    service.onModuleInit();
    events.emit('completed', { jobId: 'job-1', status: 'completed' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(usageLedger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        module: 'novel',
        resourceId: 'book-1',
        scope: 'chapter:3',
        kind: 'video',
        provider: 'volcengine.seedance',
        model: '720p',
        costCny: 0.5,
        ok: true,
        idempotencyKey: 'video:job-1:completed',
      }),
    );
  });

  it('records image failure with the final fallback model from provider error metadata', async () => {
    const imageErr = new Error('all seedream models failed') as Error & {
      providerModel?: string;
      attemptedModels?: string[];
    };
    imageErr.providerModel = 'doubao-seedream-4-0-250828';
    imageErr.attemptedModels = [
      'doubao-seedream-5-0-260128',
      'doubao-seedream-4-5-251128',
      'doubao-seedream-4-0-250828',
    ];

    const imageProvider = {
      name: 'volcengine.doubao-seedream',
      model: 'doubao-seedream-5-0-260128',
      capabilities: new Set(['t2i']),
      generate: jest.fn().mockRejectedValue(imageErr),
    };
    const registry = {
      getImageProvider: jest.fn().mockReturnValue(imageProvider),
    } as any;
    const jobService = {} as any;
    const traceLogger = { logT2i: jest.fn() } as any;
    const usageLedger = { record: jest.fn().mockResolvedValue(null) } as any;
    const billingResolver = {} as any;
    const configService = {} as any;

    const service = new MediaService(
      registry,
      jobService,
      traceLogger,
      usageLedger,
      billingResolver,
      configService,
    );

    await expect(
      service.generateImage({
        prompt: 'test prompt',
        dramaId: 'drama-1',
        userId: 'user-1',
        assetType: 'character_refine',
      }),
    ).rejects.toBe(imageErr);

    expect(usageLedger.record).toHaveBeenCalledWith(expect.objectContaining({
      module: 'drama',
      resourceId: 'drama-1',
      scope: 'creation',
      kind: 'image',
      provider: 'volcengine.doubao-seedream',
      model: 'unknown',
      ok: false,
      costCny: 0,
    }));
    expect(traceLogger.logT2i).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'volcengine.doubao-seedream',
      model: 'unknown',
      status: 'error',
    }));
  });
});
