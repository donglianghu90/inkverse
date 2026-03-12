import { VolcengineImageProvider } from './volcengine-image.provider';
import { VolcengineClient } from './volcengine.client';

const MODEL = 'doubao-seedream-5-0-260128';

function makeProvider(post: jest.Mock): VolcengineImageProvider {
  const client = { post } as unknown as VolcengineClient;
  return new VolcengineImageProvider(client, {
    models: [MODEL],
    defaultSize: '1:1',
    defaultResolution: '2K',
    watermark: false,
  });
}

describe('VolcengineImageProvider', () => {
  it('generates image with configured model', async () => {
    const post = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ url: 'https://img.example/ok.png' }] });
    const provider = makeProvider(post);

    const result = await provider.generate({ prompt: 'test prompt' });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1].model).toBe(MODEL);
    expect(result.images[0].url).toBe('https://img.example/ok.png');
  });

  it('throws when generation fails', async () => {
    const err = new Error('generation failed');
    const post = jest.fn().mockRejectedValueOnce(err);
    const provider = makeProvider(post);

    await expect(provider.generate({ prompt: 'test prompt' })).rejects.toThrow('generation failed');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('retries without image_urls when reference image is invalid', async () => {
    const invalidImageErr = {
      response: { data: { error: { message: 'image not valid' } } },
      message: 'invalid image',
    };
    const post = jest
      .fn()
      .mockRejectedValueOnce(invalidImageErr)
      .mockResolvedValueOnce({ data: [{ url: 'https://img.example/no-ref.png' }] });
    const provider = makeProvider(post);

    const result = await provider.generate({
      prompt: 'test prompt',
      referenceImages: [{ url: 'https://img.example/ref.png' }],
    });

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][1].model).toBe(MODEL);
    expect(post.mock.calls[0][1].image_urls).toEqual(['https://img.example/ref.png']);
    expect(post.mock.calls[1][1].model).toBe(MODEL);
    expect(post.mock.calls[1][1].image_urls).toBeUndefined();
  });
});
