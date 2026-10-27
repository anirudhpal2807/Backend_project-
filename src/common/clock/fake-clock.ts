import { IClock } from './clock.interface';

export class FakeClock implements IClock {
  private currentTime: Date;

  constructor(initialTime?: Date | string | number) {
    if (initialTime) {
      this.currentTime = new Date(initialTime);
    } else {
      this.currentTime = new Date('2026-10-27T10:00:00.000Z');
    }
  }

  now(): Date {
    return new Date(this.currentTime.getTime());
  }

  nowMs(): number {
    return this.currentTime.getTime();
  }

  toISOString(): string {
    return this.currentTime.toISOString();
  }

  advanceByMs(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }

  advanceBySeconds(seconds: number): void {
    this.advanceByMs(seconds * 1000);
  }

  advanceByMinutes(minutes: number): void {
    this.advanceByMs(minutes * 60 * 1000);
  }

  setTime(time: Date | string | number): void {
    this.currentTime = new Date(time);
  }
}
