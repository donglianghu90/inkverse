import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DataSource } from 'typeorm';
import { ShotMediaEntity } from '../modules/drama/entities/shot-media.entity';

async function bootstrap() {
  console.log('Bootstrapping migration script...');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const dataSource = app.get(DataSource);
  
  console.log('Querying legacy JSONB columns...');
  let rows: any[] = [];
  try {
    rows = await dataSource.query(`SELECT id, "shotMediaMap" FROM drama_episodes WHERE "shotMediaMap" IS NOT NULL`);
  } catch (err: any) {
    if (err.message.includes('column "shotMediaMap" does not exist')) {
      console.log('Column "shotMediaMap" already removed from DB. Cannot run migration from this DB state.');
      await app.close();
      return;
    }
    throw err;
  }
  
  console.log(`Found ${rows.length} episodes to migrate.`);
  
  const shotMediaRepo = dataSource.getRepository(ShotMediaEntity);
  let totalMigrated = 0;
  
  for (const row of rows) {
    const episodeId = row.id;
    const map = row.shotMediaMap;
    if (!map || typeof map !== 'object') continue;
    
    const shotKeys = Object.keys(map);
    if (shotKeys.length === 0) continue;
    
    const entitiesToInsert: Partial<ShotMediaEntity>[] = [];
    for (const [shotId, entry] of Object.entries(map as Record<string, any>)) {
      entitiesToInsert.push({
        episodeId,
        shotId,
        imageUrl: entry.imageUrl || '',
        lastFrameImageUrl: entry.lastFrameImageUrl || '',
        videoUrl: entry.videoUrl || '',
        videoJobId: entry.videoJobId || '',
        videoProvider: entry.videoProvider || '',
        ttsUrl: entry.ttsUrl || '',
        t2iPrompt: entry.t2iPrompt || '',
        t2iNegativePrompt: entry.t2iNegativePrompt || '',
        lastFrameT2iPrompt: entry.lastFrameT2iPrompt || '',
        status: entry.status || 'not_started',
        qc: entry.qc || null,
        videoQcIssues: entry.videoQcIssues || null,
        kenBurnsFallback: entry.kenBurnsFallback || false,
      });
    }
    
    if (entitiesToInsert.length > 0) {
      await shotMediaRepo.upsert(entitiesToInsert, ['episodeId', 'shotId']);
      totalMigrated += entitiesToInsert.length;
      console.log(`Migrated ${entitiesToInsert.length} shots for episode ${episodeId}`);
    }
  }
  
  console.log(`Migration completed successfully! Total shots migrated: ${totalMigrated}`);
  await app.close();
}

bootstrap().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
