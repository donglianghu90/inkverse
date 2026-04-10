import { Entity, Column, PrimaryGeneratedColumn, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum ProposalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

@Entity('prompt_optimization_proposals')
export class PromptOptimizationProposalEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Index('idx_prompt_opt_drama_id')
  @Column({ name: 'drama_id', type: 'varchar', length: 64, nullable: true })
  dramaId!: string | null;

  @Column({ name: 'episode_number', type: 'int', nullable: true })
  episodeNumber!: number | null;

  @Index('idx_prompt_opt_genre_key')
  @Column({ name: 'genre_key', type: 'varchar', length: 100, nullable: true })
  genreKey!: string | null;

  @Column({ name: 'target_agent_key', type: 'varchar', length: 100 })
  targetAgentKey!: string;

  @Column({ name: 'target_config_area', type: 'varchar', length: 100 })
  targetConfigArea!: string; // e.g. 'genreRules', 'visualStyleGuide', 'cameraStyleGuide'

  @Column({ name: 'suggested_rule', type: 'text' })
  suggestedRule!: string;

  @Column({ name: 'root_cause', type: 'text' })
  rootCause!: string;

  @Column({ name: 'evidence_links', type: 'jsonb', default: '[]' })
  evidenceLinks!: string[];

  @Index('idx_prompt_opt_status')
  @Column({ name: 'status', type: 'enum', enum: ProposalStatus, default: ProposalStatus.PENDING })
  status!: ProposalStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
