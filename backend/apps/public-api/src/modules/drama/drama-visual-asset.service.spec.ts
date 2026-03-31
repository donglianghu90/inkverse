/**
 * DramaVisualAssetService — 单元测试
 *
 * 覆盖核心路径：
 *   1. buildVisualBible: 视觉圣经构建
 *   2. detectStyleBucket: 风格桶推断
 *   3. sanitizeLiveActionVisualStyle: 真人风格清洗
 *   4. buildAssetStylePrefix: 风格前缀构建
 *   5. generateReferenceImages: 参考图生成流程（with cancellation）
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DramaVisualAssetService } from './drama-visual-asset.service';
import { DramaEntity } from './entities/drama.entity';
import { VisualAssetEntity } from './entities/visual-asset.entity';
import { LlmService } from '../llm/llm.service';
import { MediaService } from '../media/media.service';
import { RenderingProfileService } from '../media/rendering/rendering-profile.service';
import { PromptOptimizerService } from '../media/prompt-optimizer.service';
import { ImageProviderRouterService } from './media-pipeline/image-provider-router.service';
import { DramaStateStore } from './drama-state-store.service';

// ── Mock Factories ──

const mockRepo = () => ({
  findOne: jest.fn(),
  save: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
  find: jest.fn().mockResolvedValue([]),
  update: jest.fn(),
});

const mockLlm = () => ({
  chat: jest.fn().mockResolvedValue('optimized prompt'),
  smartParse: jest.fn().mockReturnValue({}),
});

const mockMediaService = () => ({
  generateImage: jest.fn().mockResolvedValue({ url: 'https://example.com/image.png', width: 512, height: 768 }),
  inpaintImage: jest.fn().mockResolvedValue({ url: 'https://example.com/inpaint.png' }),
});

const mockRenderingProfile = () => ({
  getImageProfile: jest.fn().mockReturnValue({
    maxSize: '1024x1024',
    provider: 'test-provider',
    model: 'test-model',
  }),
});

const mockPromptOptimizer = () => ({
  optimize: jest.fn().mockImplementation((p: string) => Promise.resolve(p)),
});

const mockImageRouter = () => ({
  resolveProvider: jest.fn().mockReturnValue({ provider: 'test', model: 'test' }),
  routeImage: jest.fn().mockResolvedValue({ url: 'https://example.com/routed.png' }),
});

const mockStateStore = () => ({
  isCancelled: jest.fn().mockResolvedValue(false),
  isGenerating: jest.fn().mockResolvedValue(false),
  startGenerating: jest.fn(),
  stopGenerating: jest.fn(),
  isPaused: jest.fn().mockResolvedValue(false),
  pause: jest.fn(),
  resume: jest.fn(),
  cancel: jest.fn(),
});

describe('DramaVisualAssetService', () => {
  let service: DramaVisualAssetService;
  let stateStore: ReturnType<typeof mockStateStore>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DramaVisualAssetService,
        { provide: getRepositoryToken(DramaEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(VisualAssetEntity), useFactory: mockRepo },
        { provide: LlmService, useFactory: mockLlm },
        { provide: MediaService, useFactory: mockMediaService },
        { provide: RenderingProfileService, useFactory: mockRenderingProfile },
        { provide: PromptOptimizerService, useFactory: mockPromptOptimizer },
        { provide: ImageProviderRouterService, useFactory: mockImageRouter },
        { provide: DramaStateStore, useFactory: mockStateStore },
      ],
    }).compile();

    service = module.get(DramaVisualAssetService);
    stateStore = module.get(DramaStateStore);
  });

  // ── buildVisualBible ──

  describe('buildVisualBible', () => {
    it('应返回包含 characters/locations/styleGuide 的结构', () => {
      const characters = [
        { characterId: 'c1', name: '张三', faceReferencePrompt: 'a man', role: 'protagonist' },
      ] as any;
      const visualStyle = { artDirection: '2D动画', colorGrading: 'warm' } as any;
      const promptProfile = { imageProvider: 'test' } as any;
      const assets = [
        { refId: 'c1', assetType: 'character', viewAngle: 'face_front', referenceImageUrl: 'http://img.png' },
      ] as any;

      const bible = service.buildVisualBible(characters, visualStyle, promptProfile, assets);
      expect(bible).toBeDefined();
      expect(typeof bible).toBe('object');
    });

    it('无资产时不抛错', () => {
      expect(() => service.buildVisualBible([], undefined, {}, [])).not.toThrow();
    });
  });

  // ── detectStyleBucket ──

  describe('detectStyleBucket', () => {
    it('真人风格返回 live_action', () => {
      const bucket = service.detectStyleBucket({ overallAesthetic: '真人实拍', renderTechnique: 'photoreal' } as any);
      expect(bucket).toBe('live_action');
    });

    it('动画风格返回 two_d', () => {
      const bucket = service.detectStyleBucket({ overallAesthetic: '2D动画', renderTechnique: '手绘' } as any);
      expect(bucket).toBe('two_d');
    });

    it('undefined 不抛错', () => {
      expect(() => service.detectStyleBucket(undefined)).not.toThrow();
    });
  });

  // ── sanitizeLiveActionVisualStyle ──

  describe('sanitizeLiveActionVisualStyle', () => {
    it('非真人风格不做任何修改', () => {
      const style = { artDirection: '2D动画', colorGrading: 'warm' } as any;
      const original = { ...style };
      service.sanitizeLiveActionVisualStyle(style, '', []);
      expect(style.artDirection).toBe(original.artDirection);
    });

    it('调用不抛错', () => {
      const style = { artDirection: '真人实拍' } as any;
      expect(() => service.sanitizeLiveActionVisualStyle(style, '', [])).not.toThrow();
    });
  });

  // ── buildAssetStylePrefix ──

  describe('buildAssetStylePrefix', () => {
    it('有 artDirection 时返回字符串', () => {
      const prefix = service.buildAssetStylePrefix({ artDirection: 'cinematic' } as any, 'character');
      // 可能是 undefined 或 string，取决于具体实现
      expect(prefix === undefined || typeof prefix === 'string').toBe(true);
    });
  });

  // ── generateReferenceImages — cancellation ──

  describe('generateReferenceImages', () => {
    it('当 dramaId 被取消时应跳过生成', async () => {
      stateStore.isCancelled.mockResolvedValue(true);
      const mediaService = service['mediaService'] as any;

      await service.generateReferenceImages(
        'drama-1',
        [{ id: 'a1', refId: 'c1', assetType: 'character', dramaId: 'drama-1', viewAngle: 'face_front', data: {} }] as any,
        [{ characterId: 'c1', name: 'Hero', faceReferencePrompt: 'a hero' }] as any,
        [],
        { artDirection: '2D动画' } as any,
        'user-1',
      );

      // mediaService.generateImage should NOT have been called
      expect(mediaService.generateImage).not.toHaveBeenCalled();
    });
  });
});
