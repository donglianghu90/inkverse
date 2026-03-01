import { DataSource } from 'typeorm';
import { join } from 'path';
import { read } from 'properties-parser';

type CliOptions = {
  bookId?: string;
  fromChapter?: number;
  toChapter?: number;
  limit?: number;
  dryRun: boolean;
};

type ChapterMemoryRow = {
  book_id: string;
  chapter_number: number;
  character_ids: string[];
};

type ArtifactRow = {
  payload: {
    characters?: Array<{
      id?: string;
      status?: { level?: unknown; lifecycleStatus?: string; locationId?: string | null };
      psychology?: { currentMood?: string };
    }>;
  };
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bookId') options.bookId = argv[++i];
    else if (a === '--from') options.fromChapter = Number(argv[++i]);
    else if (a === '--to') options.toChapter = Number(argv[++i]);
    else if (a === '--limit') options.limit = Number(argv[++i]);
    else if (a === '--dryRun') options.dryRun = true;
  }
  return options;
}

function buildCharacterStates(
  characterIds: string[],
  snapshot?: ArtifactRow['payload'],
): Record<string, { level: string; mood: string; status: string; location: string }> {
  const characters = snapshot?.characters ?? [];
  const map = new Map(
    characters
      .filter((c) => c?.id)
      .map((c) => [String(c.id), c] as const),
  );
  const result: Record<string, { level: string; mood: string; status: string; location: string }> = {};
  for (const id of characterIds ?? []) {
    const c = map.get(id);
    if (!c) continue;
    result[id] = {
      level: String(c.status?.level ?? ''),
      mood: String(c.psychology?.currentMood ?? '').slice(0, 50),
      status: c.status?.lifecycleStatus ?? 'active',
      location: c.status?.locationId ?? '',
    };
  }
  return result;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const configPath = join(process.cwd(), 'config', 'public.properties');
  const props = read(configPath) as Record<string, string>;
  const dataSource = new DataSource({
    type: 'postgres',
    host: props['db.pg.host'],
    port: parseInt(props['db.pg.port'] || '5432', 10),
    username: props['db.pg.user'],
    password: props['db.pg.password'],
    database: props['db.pg.database'],
    synchronize: false,
  });
  await dataSource.initialize();
  console.log('✅ 数据库连接成功');

  const where: string[] = [`(character_states IS NULL OR character_states = '{}'::jsonb)`];
  const params: unknown[] = [];
  if (opts.bookId) {
    params.push(opts.bookId);
    where.push(`book_id = $${params.length}`);
  }
  if (typeof opts.fromChapter === 'number' && Number.isFinite(opts.fromChapter)) {
    params.push(opts.fromChapter);
    where.push(`chapter_number >= $${params.length}`);
  }
  if (typeof opts.toChapter === 'number' && Number.isFinite(opts.toChapter)) {
    params.push(opts.toChapter);
    where.push(`chapter_number <= $${params.length}`);
  }
  const limit = Number.isFinite(opts.limit) && (opts.limit as number) > 0 ? Math.floor(opts.limit as number) : 5000;
  params.push(limit);
  const sql = `
    SELECT book_id, chapter_number, character_ids
    FROM chapter_memories
    WHERE ${where.join(' AND ')}
    ORDER BY book_id ASC, chapter_number ASC
    LIMIT $${params.length}
  `;
  const rows = await dataSource.query(sql, params) as ChapterMemoryRow[];
  console.log(`ℹ️ 待回填记录: ${rows.length}`);
  if (rows.length === 0) {
    await dataSource.destroy();
    console.log('✅ 无需回填');
    return;
  }

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const artifactRows = await dataSource.query(
      `SELECT payload FROM artifacts WHERE book_id = $1 AND chapter_number = $2 AND name = 'state_snapshot' LIMIT 1`,
      [row.book_id, row.chapter_number],
    ) as ArtifactRow[];
    const snapshot = artifactRows[0]?.payload;
    const characterStates = buildCharacterStates(row.character_ids ?? [], snapshot);
    if (Object.keys(characterStates).length === 0) {
      skipped++;
      continue;
    }
    if (!opts.dryRun) {
      await dataSource.query(
        `UPDATE chapter_memories
         SET character_states = $1::jsonb
         WHERE book_id = $2 AND chapter_number = $3`,
        [JSON.stringify(characterStates), row.book_id, row.chapter_number],
      );
    }
    updated++;
    if ((updated + skipped) % 200 === 0) {
      console.log(`...进度 ${updated + skipped}/${rows.length}，已更新=${updated}，跳过=${skipped}`);
    }
  }

  console.log(`${opts.dryRun ? '🔎 DryRun完成' : '✅ 回填完成'}：更新=${updated}，跳过=${skipped}，总计=${rows.length}`);
  await dataSource.destroy();
}

main().catch(async (err) => {
  console.error('❌ 回填失败:', err);
  process.exit(1);
});
