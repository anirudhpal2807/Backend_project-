import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { DatabaseTransaction } from '../db/unit-of-work';
import { OutboxStatus } from '../db/database.types';
import { v7 as uuidv7 } from 'uuid';

export interface OutboxEventInput {
  topic: string;
  eventName: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxService {
  constructor(private readonly dbService: DatabaseService) {}

  /**
   * Writes event atomically within a transaction
   */
  async publishInTransaction(trx: DatabaseTransaction, event: OutboxEventInput): Promise<string> {
    const id = uuidv7();
    await trx
      .insertInto('outbox_events')
      .values({
        id,
        topic: event.topic,
        event_name: event.eventName,
        payload: JSON.stringify(event.payload),
        status: 'PENDING',
        retry_count: 0,
        created_at: new Date(),
        processed_at: null,
      })
      .execute();

    return id;
  }

  /**
   * Fetches pending events for the worker to dispatch
   */
  async fetchPendingEvents(limit = 50) {
    return await this.dbService.db
      .selectFrom('outbox_events')
      .selectAll()
      .where('status', '=', 'PENDING')
      .orderBy('created_at', 'asc')
      .limit(limit)
      .execute();
  }

  async markPublished(id: string) {
    await this.dbService.db
      .updateTable('outbox_events')
      .set({
        status: 'PUBLISHED',
        processed_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }

  async markFailed(id: string) {
    const event = await this.dbService.db
      .selectFrom('outbox_events')
      .select(['retry_count'])
      .where('id', '=', id)
      .executeTakeFirst();

    const newRetryCount = (event?.retry_count || 0) + 1;
    const newStatus: OutboxStatus = newRetryCount >= 5 ? 'FAILED' : 'PENDING';

    await this.dbService.db
      .updateTable('outbox_events')
      .set({
        retry_count: newRetryCount,
        status: newStatus,
      })
      .where('id', '=', id)
      .execute();
  }
}
