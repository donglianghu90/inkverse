import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('dramas')
export class DramaEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column()
  title: string;

  @Column({ default: '' })
  genre: string;

  @Column({ type: 'jsonb' })
  state: Record<string, unknown>; // DramaState JSON

  @Column({ type: 'int', default: 0 })
  episodesGenerated: number;

  @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true })
  latestOverallScore: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
