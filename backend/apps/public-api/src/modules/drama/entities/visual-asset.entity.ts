import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('drama_visual_assets')
export class VisualAssetEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  dramaId: string;

  @Column({ type: 'enum', enum: ['character', 'location', 'style_guide'] })
  assetType: 'character' | 'location' | 'style_guide';

  @Column({ default: '' })
  refId: string; // characterId 或 locationId

  @Column()
  name: string;

  @Column({ type: 'jsonb' })
  data: Record<string, unknown>; // CharacterIdentity / SceneLocation / VisualStyleGuide JSON

  @Column({ default: '' })
  referenceImageUrl: string; // 参考图URL（定妆照/场景图）

  @CreateDateColumn()
  createdAt: Date;
}
