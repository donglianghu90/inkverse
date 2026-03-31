import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameEpisodeMediaCostUsdToCny202603240001 implements MigrationInterface {
  name = 'RenameEpisodeMediaCostUsdToCny202603240001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "drama_episodes"
      RENAME COLUMN "media_cost_usd" TO "media_cost_cny"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "drama_episodes"
      RENAME COLUMN "media_cost_cny" TO "media_cost_usd"
    `);
  }
}
