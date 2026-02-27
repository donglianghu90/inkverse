export const AUTO_SERIALIZATION_QUEUE = 'novel-auto-serialization';

export interface AutoSerializationJobPayload {
  bookId: string;
  trigger: 'scheduled' | 'manual';
}
