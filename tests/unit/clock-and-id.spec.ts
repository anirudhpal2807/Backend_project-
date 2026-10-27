import { FakeClock } from '../../src/common/clock/fake-clock';
import { SystemClock } from '../../src/common/clock/system-clock';
import { UuidV7IdGenerator } from '../../src/common/id/uuidv7-id-generator';

describe('Clock and ID Generator Abstractions (T-016 / T-038)', () => {
  describe('SystemClock', () => {
    it('returns current date and timestamp', () => {
      const clock = new SystemClock();
      const before = Date.now();
      const now = clock.now();
      const after = Date.now();

      expect(now.getTime()).toBeGreaterThanOrEqual(before);
      expect(now.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('FakeClock', () => {
    it('allows advancing time deterministically', () => {
      const initial = '2026-10-27T10:00:00.000Z';
      const clock = new FakeClock(initial);

      expect(clock.toISOString()).toBe(initial);

      clock.advanceByMinutes(15);
      expect(clock.toISOString()).toBe('2026-10-27T10:15:00.000Z');

      clock.advanceBySeconds(30);
      expect(clock.toISOString()).toBe('2026-10-27T10:15:30.000Z');
    });
  });

  describe('UuidV7IdGenerator', () => {
    it('generates valid UUIDv7 strings that are monotonically ordered by time', async () => {
      const generator = new UuidV7IdGenerator();
      const id1 = generator.generate();
      await new Promise(r => setTimeout(r, 2));
      const id2 = generator.generate();

      // UUID format validation
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(id1).toMatch(uuidRegex);
      expect(id2).toMatch(uuidRegex);
      expect(id1).not.toBe(id2);
      expect(id1 < id2).toBe(true); // Lexicographical ordering property of UUIDv7
    });
  });
});
