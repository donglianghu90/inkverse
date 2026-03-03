/** 将 assets/audio 下所有音频文件上传到阿里云 OSS，并生成 mapping.json（OSS URL） */
import * as fs from 'fs';
import * as path from 'path';
import OSS from 'ali-oss';

const OSS_PREFIX = 'inkverse/audio'; // OSS 目录前缀
const AUDIO_DIR = path.join(__dirname, '..', 'assets', 'audio');

const config = {
  region: process.env.OSS_REGION ,
  accessKeyId: process.env.OSS_AK,
  accessKeySecret: process.env.OSS_SK ,
  bucket: process.env.OSS_BUCKET ,
  secure: true,
};

async function main() {
  const client = new OSS(config);
  const mapping: Record<string, Record<string, string>> = { bgm: {}, sfx: {}, ambience: {} };
  const categories = ['bgm', 'sfx', 'ambience'];
  let uploaded = 0;

  for (const cat of categories) {
    const dir = path.join(AUDIO_DIR, cat);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp3'));

    for (const file of files) {
      const localPath = path.join(dir, file);
      const ossPath = `${OSS_PREFIX}/${cat}/${file}`;
      const label = file.replace('.mp3', '').replace(/-/g, '_');

      try {
        const result = await client.put(ossPath, localPath);
        const url = result.url.replace('http://', 'https://');
        mapping[cat][label] = url;
        uploaded++;
        console.log(`  ✓ ${ossPath} → ${url}`);
      } catch (err: any) {
        console.error(`  ✗ ${ossPath}: ${err.message}`);
      }
    }
  }

  const mappingPath = path.join(AUDIO_DIR, 'mapping.json');
  fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));
  console.log(`\n✅ 上传完成: ${uploaded} 个文件`);
  console.log(`📄 mapping.json → ${mappingPath}`);

  const baseUrl = `https://${config.bucket}.${config.region}.aliyuncs.com/${OSS_PREFIX}`;
  console.log(`\n🔗 OSS Base URL: ${baseUrl}`);
  console.log(`💡 在 public.properties 中设置: media.audio.baseUrl = ${baseUrl}`);
}

main().catch(err => { console.error('上传失败:', err); process.exit(1); });
