import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export interface GenerationProgressEvent {
  bookId: string;
  chapterNumber: number;
  step: string;
  stepIndex: number;
  totalSteps: number;
  message: string;
  done: boolean;
  error?: string;
}

@Injectable()
export class NovelProgressService {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit(event: GenerationProgressEvent): void {
    this.emitter.emit(`progress:${event.bookId}`, event);
  }

  subscribe(
    bookId: string,
    listener: (event: GenerationProgressEvent) => void,
  ): () => void {
    this.emitter.on(`progress:${bookId}`, listener);
    return () => this.emitter.removeListener(`progress:${bookId}`, listener);
  }
}
