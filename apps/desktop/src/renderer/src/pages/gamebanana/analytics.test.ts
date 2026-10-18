import { describe, expect, it } from 'vitest';
import { linePoints } from './analytics';

describe('linePoints', () => {
  it('scales values to the chart box', () => {
    expect(linePoints([0, 5, 10])).toBe('0,38 50,20 100,2');
    expect(linePoints([0, 0])).toBe('0,38 100,38');
    expect(linePoints([3])).toBe('0,2');
  });
});
