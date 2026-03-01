/**
 * End-to-end happy-path for novel APIs:
 * create book -> generate chapter -> batch generate -> read chapter -> fetch KPI summary.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { AppModule } from '../../../app.module';

describe('Novel API (e2e)', () => {
  let app: INestApplication;
  let httpApp: any;
  let dataSource: DataSource;

  beforeAll(async () => {
    // Keep e2e deterministic while still exercising PostgreSQL persistence path.
    process.env.LLM_DRY_RUN = 'true';
    process.env.ENABLE_LANGGRAPH = 'false';
    // Keep e2e independent from Redis/BullMQ infra.
    process.env.AUTO_SERIALIZATION_ENABLED = 'false';
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/novel_engine';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
    // Use underlying Express app directly so supertest does not bind a real port.
    httpApp = app.getHttpAdapter().getInstance();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should create book, auto-generate chapters, read chapter and return kpi summary', async () => {
    const createRes = await request(httpApp)
      .post('/novel/books')
      .send({
        mainIdea: '主角是一座庙，通过香火变强',
        genre: '玄幻',
        targetAudience: '男频网文读者',
        mainStoryGoal: '成仙',
        titleHint: '香火神庙',
      })
      .expect(201);

    expect(createRes.body.bookId).toBeDefined();
    const bookId: string = createRes.body.bookId;

    const chapterRes = await request(httpApp)
      .post(`/novel/books/${bookId}/chapters`)
      .send({ maxRepairRounds: 1 })
      .expect(201);

    expect(chapterRes.body.bookId).toBe(bookId);
    expect(chapterRes.body.chapterNumber).toBeDefined();
    expect(chapterRes.body.nextChapterCursor).toBeGreaterThan(1);

    const batchRes = await request(httpApp)
      .post(`/novel/books/${bookId}/chapters/batch`)
      .send({
        chapterCount: 2,
        maxRepairRounds: 1,
      })
      .expect(201);

    expect(batchRes.body.generatedChapters).toBe(2);
    expect(Array.isArray(batchRes.body.chapters)).toBe(true);

    const listRes = await request(httpApp)
      .get(`/novel/books/${bookId}/chapters?limit=2`)
      .expect(200);

    expect(listRes.body.bookId).toBe(bookId);
    expect(Array.isArray(listRes.body.chapters)).toBe(true);
    expect(listRes.body.chapters.length).toBeGreaterThan(0);

    const latestChapterNumber: number = listRes.body.chapters[0].chapterNumber;
    const getChapterRes = await request(httpApp)
      .get(`/novel/books/${bookId}/chapters/${latestChapterNumber}`)
      .expect(200);

    expect(getChapterRes.body.bookId).toBe(bookId);
    expect(getChapterRes.body.chapterNumber).toBe(latestChapterNumber);
    expect(getChapterRes.body.content).toBeDefined();

    const getBookRes = await request(httpApp)
      .get(`/novel/books/${bookId}`)
      .expect(200);

    expect(getBookRes.body.bookId).toBe(bookId);
    expect(getBookRes.body.latestKpi).toBeDefined();
    expect(typeof getBookRes.body.latestKpi.qualityScore).toBe('number');
    expect(typeof getBookRes.body.latestKpi.overallScore).toBe('number');
    expect(getBookRes.body.latestKpi.transitionPass).toBeUndefined();

    const kpiRes = await request(httpApp)
      .get(`/novel/books/${bookId}/kpi`)
      .expect(200);

    expect(kpiRes.body.bookId).toBe(bookId);
    expect(kpiRes.body.totalChapters).toBe(3);
    expect(typeof kpiRes.body.averageQualityScore).toBe('number');
    expect(typeof kpiRes.body.averageOverallScore).toBe('number');
    expect(kpiRes.body.latest).toBeDefined();
    expect(typeof kpiRes.body.latest.qualityScore).toBe('number');
    expect(typeof kpiRes.body.latest.overallScore).toBe('number');

    const autoConfigRes = await request(httpApp)
      .put(`/novel/books/${bookId}/auto-serialization`)
      .send({
        dailyStartTime: '23:59',
        chaptersPerRun: 1,
        maxRepairRounds: 1,
        minQualityScore: 7,
        minOverallScore: 7,
      })
      .expect(200);

    expect(autoConfigRes.body.bookId).toBe(bookId);
    expect(autoConfigRes.body.enabled).toBe(true);
    expect(autoConfigRes.body.dailyStartTime).toBe('23:59');
    expect(autoConfigRes.body.chaptersPerRun).toBe(1);
    expect(autoConfigRes.body.scheduler.nextRunAt).toBeDefined();

    const autoGetRes = await request(httpApp)
      .get(`/novel/books/${bookId}/auto-serialization`)
      .expect(200);

    expect(autoGetRes.body.bookId).toBe(bookId);
    expect(autoGetRes.body.enabled).toBe(true);

    const autoRunNowRes = await request(httpApp)
      .post(`/novel/books/${bookId}/auto-serialization/run-now`)
      .expect(201);

    expect(autoRunNowRes.body.bookId).toBe(bookId);
    expect(autoRunNowRes.body.trigger).toBe('manual');
    expect(typeof autoRunNowRes.body.accepted).toBe('boolean');

    const autoDisableRes = await request(httpApp)
      .post(`/novel/books/${bookId}/auto-serialization/disable`)
      .expect(201);

    expect(autoDisableRes.body.bookId).toBe(bookId);
    expect(autoDisableRes.body.enabled).toBe(false);
  });

  it('should heal lagging chapterCursor when chapters already exist', async () => {
    const createRes = await request(httpApp)
      .post('/novel/books')
      .send({
        mainIdea: '主角靠经营茶馆逆袭',
        genre: '都市',
        targetAudience: '都市网文读者',
        mainStoryGoal: '建立商业帝国',
        titleHint: '茶馆风云',
      })
      .expect(201);
    const bookId: string = createRes.body.bookId;

    const firstChapterRes = await request(httpApp)
      .post(`/novel/books/${bookId}/chapters`)
      .send({ maxRepairRounds: 1 })
      .expect(201);
    expect(firstChapterRes.body.chapterNumber).toBe(1);

    await dataSource.query(
      `UPDATE books
       SET state_json = jsonb_set(state_json, '{chapterCursor}', '1'::jsonb, true)
       WHERE book_id = $1`,
      [bookId],
    );

    const beforeHealRes = await request(httpApp)
      .get(`/novel/books/${bookId}`)
      .expect(200);
    expect(beforeHealRes.body.chaptersGenerated).toBe(1);

    const secondChapterRes = await request(httpApp)
      .post(`/novel/books/${bookId}/chapters`)
      .send({ maxRepairRounds: 1 })
      .expect(201);
    expect(secondChapterRes.body.chapterNumber).toBe(2);
    expect(secondChapterRes.body.nextChapterCursor).toBe(3);

    const listRes = await request(httpApp)
      .get(`/novel/books/${bookId}/chapters?limit=10`)
      .expect(200);
    const chapterNumbers = listRes.body.chapters.map((ch: { chapterNumber: number }) => ch.chapterNumber);
    expect(chapterNumbers).toContain(1);
    expect(chapterNumbers).toContain(2);
  });
});
