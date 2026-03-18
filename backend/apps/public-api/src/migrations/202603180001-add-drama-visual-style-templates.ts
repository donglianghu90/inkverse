import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDramaVisualStyleTemplates202603180001 implements MigrationInterface {
  name = 'AddDramaVisualStyleTemplates202603180001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "drama_visual_style_templates" (
        "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"               varchar(64),
        "style_key"             varchar(100) NOT NULL,
        "display_name"          varchar(200) NOT NULL,
        "description"           text NOT NULL DEFAULT '',
        "style_category"        varchar(50) NOT NULL DEFAULT 'live_action',
        "tags"                  jsonb NOT NULL DEFAULT '[]',
        "visual_guide"          jsonb NOT NULL DEFAULT '{}',
        "prompt_guidance"       jsonb,
        "genre_compatibility"   jsonb NOT NULL DEFAULT '[]',
        "audience_tags"         jsonb NOT NULL DEFAULT '[]',
        "platform_tags"         jsonb NOT NULL DEFAULT '[]',
        "is_system"             boolean NOT NULL DEFAULT false,
        "parent_template_id"    uuid,
        "system_version"        int NOT NULL DEFAULT 1,
        "synced_system_version" int NOT NULL DEFAULT 0,
        "is_user_modified"      boolean NOT NULL DEFAULT false,
        "created_at"            timestamptz NOT NULL DEFAULT now(),
        "updated_at"            timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_drama_vis_tpl_user_style" UNIQUE ("user_id", "style_key")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_drama_vis_tpl_user_id"
        ON "drama_visual_style_templates" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_drama_vis_tpl_user_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "drama_visual_style_templates"`);
  }
}
