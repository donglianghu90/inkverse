import { NestFactory } from '@nestjs/core';
import { AppModule } from '../apps/public-api/src/app.module';
import { OssService } from '@packages/modules';
import * as fs from 'fs';
import * as path from 'path';

const OSS_PREFIX = 'inkverse/templates/covers';
const COVERS_DIR = '/Users/hudongliang/.gemini/antigravity/brain/40aa144e-2d92-4ae7-8a3f-7a8c4c7a7961';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ossService = app.get(OssService);
  
  const mapping: Record<string, string> = {};
  if (!fs.existsSync(COVERS_DIR)) {
    console.error('Covers dir not found', COVERS_DIR);
    await app.close();
    return;
  }
  
  const files = fs.readdirSync(COVERS_DIR).filter(f => f.endsWith('.png') && (f.startsWith('genre_') || f.startsWith('style_')));
  let uploaded = 0;

  for (const file of files) {
    const localPath = path.join(COVERS_DIR, file);
    const baseName = file.replace(/_\d{13}\.png$/, '.png');
    const ossPath = `${OSS_PREFIX}/${baseName}`;
    const mappingKey = baseName.replace('.png', '');

    try {
      const result = await ossService.uploadFile(ossPath, localPath);
      const url = result.url.replace('http://', 'https://');
      mapping[mappingKey] = url;
      uploaded++;
      console.log(`  ✓ ${ossPath} → ${url}`);
    } catch (err: any) {
      console.error(`  ✗ ${ossPath}: ${err.message}`);
    }
  }

  const mappingPath = path.join(__dirname, 'cover-mapping.json');
  fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));
  console.log(`\n✅ Upload complete: ${uploaded} files`);
  console.log(`📄 mapping.json → ${mappingPath}`);
  
  await app.close();
  process.exit(0);
}

bootstrap().catch(err => {
  console.error(err);
  process.exit(1);
});
