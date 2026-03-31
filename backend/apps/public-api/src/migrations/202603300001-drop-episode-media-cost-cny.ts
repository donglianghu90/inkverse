import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropEpisodeMediaCostCny202603300001 implements MigrationInterface {
  name = 'DropEpisodeMediaCostCny202603300001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "drama_episodes"
      DROP COLUMN IF EXISTS "media_cost_cny"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "drama_episodes"
      ADD COLUMN "media_cost_cny" DECIMAL(8, 4) DEFAULT 0
    `);
  }
}
