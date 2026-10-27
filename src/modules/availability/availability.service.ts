import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { CreateAvailabilityRuleDto } from './dto/availability.dto';
import { v7 as uuidv7 } from 'uuid';

@Injectable()
export class AvailabilityService {
  constructor(private readonly dbService: DatabaseService) {}

  async createRule(doctorId: string, dto: CreateAvailabilityRuleDto) {
    const id = uuidv7();
    const duration = dto.slotDurationMinutes || 30;

    await this.dbService.db
      .insertInto('availability_rules')
      .values({
        id,
        doctor_id: doctorId,
        day_of_week: dto.dayOfWeek,
        start_time: dto.startTime,
        end_time: dto.endTime,
        slot_duration_minutes: duration,
      })
      .execute();

    // Trigger slot materialization for this rule
    await this.materializeSlots(doctorId, 30);

    return { message: 'Availability rule created and slots materialized.', ruleId: id };
  }

  async materializeSlots(doctorId: string, horizonDays = 30): Promise<{ slotsCreated: number }> {
    const rules = await this.dbService.db
      .selectFrom('availability_rules')
      .selectAll()
      .where('doctor_id', '=', doctorId)
      .execute();

    if (rules.length === 0) {
      return { slotsCreated: 0 };
    }

    const now = new Date();
    let slotsCreated = 0;

    for (let dayOffset = 1; dayOffset <= horizonDays; dayOffset++) {
      const targetDate = new Date(now);
      targetDate.setDate(now.getDate() + dayOffset);
      const dayOfWeek = targetDate.getDay();

      const matchingRules = rules.filter(r => r.day_of_week === dayOfWeek);

      for (const rule of matchingRules) {
        const [startH, startM] = rule.start_time.split(':').map(Number);
        const [endH, endM] = rule.end_time.split(':').map(Number);

        const slotStart = new Date(targetDate);
        slotStart.setHours(startH, startM, 0, 0);

        const ruleEnd = new Date(targetDate);
        ruleEnd.setHours(endH, endM, 0, 0);

        while (slotStart.getTime() + rule.slot_duration_minutes * 60 * 1000 <= ruleEnd.getTime()) {
          const slotEnd = new Date(slotStart.getTime() + rule.slot_duration_minutes * 60 * 1000);

          // Check if slot already exists to be idempotent
          const exists = await this.dbService.db
            .selectFrom('availability_slots')
            .select(['id'])
            .where('doctor_id', '=', doctorId)
            .where('start_at', '=', slotStart)
            .executeTakeFirst();

          if (!exists) {
            try {
              await this.dbService.db
                .insertInto('availability_slots')
                .values({
                  id: uuidv7(),
                  doctor_id: doctorId,
                  start_at: slotStart,
                  end_at: slotEnd,
                  status: 'OPEN',
                })
                .execute();
              slotsCreated++;
            } catch {
              // GIST exclusion constraint will catch and prevent any race condition
            }
          }

          slotStart.setTime(slotEnd.getTime());
        }
      }
    }

    return { slotsCreated };
  }

  async listSlots(doctorId: string, startDate?: string, endDate?: string) {
    let query = this.dbService.db
      .selectFrom('availability_slots')
      .selectAll()
      .where('doctor_id', '=', doctorId)
      .where('status', '=', 'OPEN');

    if (startDate) {
      query = query.where('start_at', '>=', new Date(startDate));
    } else {
      query = query.where('start_at', '>=', new Date());
    }

    if (endDate) {
      query = query.where('start_at', '<=', new Date(endDate));
    }

    return await query.orderBy('start_at', 'asc').limit(100).execute();
  }

  async blockSlot(doctorId: string, slotId: string) {
    const slot = await this.dbService.db
      .selectFrom('availability_slots')
      .selectAll()
      .where('id', '=', slotId)
      .where('doctor_id', '=', doctorId)
      .executeTakeFirst();

    if (!slot) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Slot not found.');
    }

    if (slot.status === 'BOOKED' || slot.status === 'HELD') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        'Cannot block a slot that has an active booking or hold. Cancel the consultation first.',
      );
    }

    await this.dbService.db
      .updateTable('availability_slots')
      .set({ status: 'BLOCKED', updated_at: new Date() })
      .where('id', '=', slotId)
      .execute();

    return { message: 'Slot blocked successfully.', slotId };
  }

  async unblockSlot(doctorId: string, slotId: string) {
    const slot = await this.dbService.db
      .selectFrom('availability_slots')
      .selectAll()
      .where('id', '=', slotId)
      .where('doctor_id', '=', doctorId)
      .executeTakeFirst();

    if (!slot) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Slot not found.');
    }

    if (slot.status !== 'BLOCKED') {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'Only BLOCKED slots can be unblocked.',
      );
    }

    await this.dbService.db
      .updateTable('availability_slots')
      .set({ status: 'OPEN', updated_at: new Date() })
      .where('id', '=', slotId)
      .execute();

    return { message: 'Slot unblocked and reopened.', slotId };
  }
}
