import * as fs from 'fs';
import * as path from 'path';
import OSS from 'ali-oss';

const OSS_PREFIX = 'inkverse/templates/covers'; // OSS directory prefix
const COVERS_DIR = '/Users/hudongliang/.gemini/antigravity/brain/40aa144e-2d92-4ae7-8a3f-7a8c4c7a7961';

const config = {
  region: process.env.OSS_REGION,
  accessKeyId: process.env.OSS_AK,
  accessKeySecret: process.env.OSS_SK,
  bucket: process.env.OSS_BUCKET,
  secure: true,
};

async function main() {
  const client = new OSS(config);
  const mapping: Record<string, string> = {};
  
  if (!fs.existsSync(COVERS_DIR)) {
    console.error('Covers dir not found', COVERS_DIR);
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
      const result = await client.put(ossPath, localPath);
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
}

main().catch(err => { console.error('Upload failed:', err); process.exit(1); });
