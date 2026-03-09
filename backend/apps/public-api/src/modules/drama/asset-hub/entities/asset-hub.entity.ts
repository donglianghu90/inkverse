/** 全局资产实体 — 跨剧复用角色/场景/风格模板 */
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('drama_global_asset_folders')
export class GlobalAssetFolderEntity { // 资产文件夹（一层，不嵌套）
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() userId: string;
  @Column() name: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('drama_global_characters')
export class GlobalCharacterEntity { // 全局角色
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() userId: string;
  @Column({ nullable: true }) folderId: string;
  @Column() name: string;
  @Column({ type: 'text', nullable: true }) aliases: string; // JSON: 别名列表
  @Column({ type: 'jsonb', nullable: true }) profileData: Record<string, unknown>; // 角色档案
  @Column({ type: 'text', nullable: true }) faceReferencePrompt: string;
  @Column({ type: 'text', nullable: true }) referenceImageUrl: string;
  @Column({ type: 'jsonb', nullable: true }) variations: Record<string, unknown>[]; // 外观变体
  @Column({ type: 'text', nullable: true }) voiceConfig: string; // JSON: 音色配置
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('drama_global_locations')
export class GlobalLocationEntity { // 全局场景
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() userId: string;
  @Column({ nullable: true }) folderId: string;
  @Column() name: string;
  @Column({ type: 'text', nullable: true }) summary: string;
  @Column({ type: 'text', nullable: true }) visualPrompt: string;
  @Column({ type: 'text', nullable: true }) referenceImageUrl: string;
  @Column({ type: 'jsonb', nullable: true }) imageVariants: Record<string, unknown>[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('drama_global_styles')
export class GlobalStyleEntity { // 全局视觉风格模板
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() userId: string;
  @Column({ nullable: true }) folderId: string;
  @Column() name: string;
  @Column({ type: 'jsonb' }) styleData: Record<string, unknown>; // VisualStyle 完整数据
  @Column({ type: 'text', nullable: true }) previewImageUrl: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
