import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDramaGlobalPromptSettings202603180002 implements MigrationInterface {
  name = 'AddDramaGlobalPromptSettings202603180002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "drama_global_prompt_settings" (
        "user_id"                  varchar(64) NOT NULL DEFAULT 'system',
        "agent_type"               varchar(64) NOT NULL,
        "global_additional_prompt" text NOT NULL DEFAULT '',
        "description"              text NOT NULL DEFAULT '',
        "updated_at"               timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("user_id", "agent_type")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_drama_global_prompt_user"
      ON "drama_global_prompt_settings" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "drama_global_prompt_settings"`);
  }
}
