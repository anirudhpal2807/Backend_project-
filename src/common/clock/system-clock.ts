import { Injectable } from '@nestjs/common';
import { IClock } from './clock.interface';

@Injectable()
export class SystemClock implements IClock {
  now(): Date {
    return new Date();
  }

  nowMs(): number {
    return Date.now();
  }

  toISOString(): string {
    return new Date().toISOString();
  }
}
