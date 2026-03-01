import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCharacterStatesToChapterMemories202603010001 implements MigrationInterface {
  name = 'AddCharacterStatesToChapterMemories202603010001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "chapter_memories"
      ADD COLUMN IF NOT EXISTS "character_states" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "chapter_memories"
      DROP COLUMN IF EXISTS "character_states"
    `);
  }
}
