import { describe, expect, it } from 'vitest';

import { roundTo } from './round.js';

describe('roundTo', () => {
  it('округляет до целого по умолчанию', () => {
    expect(roundTo(2.4)).toBe(2);
    expect(roundTo(2.5)).toBe(3);
    expect(roundTo(-2.5)).toBe(-2);
  });

  it('округляет до заданного знака', () => {
    expect(roundTo(123.456, 1)).toBe(123.5);
    expect(roundTo(123.456, 2)).toBe(123.46);
  });

  it('не ломается на двоичном представлении', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(8.165, 2)).toBe(8.17);
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
  });

  it('схлопывает околонулевые значения в обычный ноль, а не в -0', () => {
    expect(roundTo(0, 2)).toBe(0);
    // Object.is(-0, 0) === false, поэтому toBe здесь проверяет именно знак:
    // «-0 г белка» в интерфейсе видеть не хочется.
    expect(roundTo(-0.001, 2)).toBe(0);
  });

  it('пропускает нечисловые значения без исключения', () => {
    expect(roundTo(Number.NaN, 2)).toBeNaN();
    expect(roundTo(Number.POSITIVE_INFINITY, 2)).toBe(Number.POSITIVE_INFINITY);
  });

  it('отвергает бессмысленную точность', () => {
    expect(() => roundTo(1.23, -1)).toThrow(RangeError);
    expect(() => roundTo(1.23, 1.5)).toThrow(RangeError);
  });
});
