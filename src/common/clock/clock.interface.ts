export interface IClock {
  now(): Date;
  nowMs(): number;
  toISOString(): string;
}

export const CLOCK_TOKEN = Symbol('CLOCK_TOKEN');
