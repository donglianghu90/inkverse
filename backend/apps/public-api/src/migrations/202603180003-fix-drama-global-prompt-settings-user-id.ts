import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fix: Add user_id to drama_global_prompt_settings when table was created by sync
 * without it. Uses DEFAULT so existing rows are backfilled with 'system'.
 */
export class FixDramaGlobalPromptSettingsUserId202603180003 implements MigrationInterface {
  name = 'FixDramaGlobalPromptSettingsUserId202603180003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('drama_global_prompt_settings');
    if (!table) return;

    const hasUserId = table.columns.some((c) => c.name === 'user_id');
    if (hasUserId) return;

    // Add with DEFAULT so existing rows get 'system' instead of NULL
    await queryRunner.query(`
      ALTER TABLE "drama_global_prompt_settings"
      ADD COLUMN "user_id" varchar(64) NOT NULL DEFAULT 'system'
    `);

    // If PK was only agent_type, we need to update it
    const pkColumns = table.columns.filter((c) => c.isPrimary);
    if (pkColumns.length === 1 && pkColumns[0].name === 'agent_type') {
      await queryRunner.query(`
        ALTER TABLE "drama_global_prompt_settings"
        DROP CONSTRAINT "drama_global_prompt_settings_pkey"
      `);
      await queryRunner.query(`
        ALTER TABLE "drama_global_prompt_settings"
        ADD PRIMARY KEY ("user_id", "agent_type")
      `);
    }

  }

  public async down(): Promise<void> {
    // Not reversible safely without data loss
  }
}
