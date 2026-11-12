import { describe, expect, it } from 'vitest';
import { friendlyDate } from './dom';

describe('friendlyDate', () => {
  const now = new Date(2026, 10, 12, 19, 30).getTime();
  const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 5).getTime();

  it('says Today and Yesterday, with the time', () => {
    expect(friendlyDate(at(12, 0), now)).toMatch(/^Today, /);
    expect(friendlyDate(at(12, 19), now)).toMatch(/^Today, /);
    expect(friendlyDate(at(11, 23), now)).toMatch(/^Yesterday, /);
    expect(friendlyDate(at(11, 0), now)).toMatch(/^Yesterday, /);
  });

  it('shows only the date for older changes', () => {
    const older = friendlyDate(at(10, 23), now);
    expect(older).not.toMatch(/Today|Yesterday/);
    expect(older).toContain('2026');
  });
});
