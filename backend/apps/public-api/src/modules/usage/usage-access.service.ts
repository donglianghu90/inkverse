/** 用量访问校验 — novel/drama 资源所有权，供 UsageController 使用 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BookEntity } from '../novel/entities/book.entity';
import { DramaEntity } from '../drama/entities/drama.entity';

@Injectable()
export class UsageAccessService {
  constructor(
    @InjectRepository(BookEntity) private readonly bookRepo: Repository<BookEntity>,
    @InjectRepository(DramaEntity) private readonly dramaRepo: Repository<DramaEntity>,
  ) {}

  async assertNovelAccess(bookId: string, userId: string): Promise<void> {
    const book = await this.bookRepo.findOne({ where: { bookId }, select: ['bookId', 'userId', 'stateJson'] });
    if (!book) throw new NotFoundException(`书籍 ${bookId} 不存在`);
    const ownerId = book.userId ?? (book.stateJson as any)?.userId;
    if (ownerId && ownerId !== userId) throw new NotFoundException(`书籍 ${bookId} 不存在`);
  }

  async assertDramaAccess(dramaId: string, userId: string): Promise<void> {
    const drama = await this.dramaRepo.findOne({ where: { id: dramaId }, select: ['id', 'userId'] });
    if (!drama) throw new NotFoundException(`短剧 ${dramaId} 不存在`);
    if (drama.userId !== userId) throw new NotFoundException(`短剧 ${dramaId} 不存在`);
  }
}
