import { describe, expect, it } from 'vitest';

import { mealTypeByTime, parseTimeOfDay } from './mealType.js';

describe('parseTimeOfDay', () => {
  it('переводит время в минуты от полуночи', () => {
    expect(parseTimeOfDay('00:00')).toBe(0);
    expect(parseTimeOfDay('12:30')).toBe(750);
    expect(parseTimeOfDay('23:59')).toBe(1439);
  });

  it('отбрасывает неверный формат', () => {
    expect(parseTimeOfDay('24:00')).toBeNull();
    expect(parseTimeOfDay('12:60')).toBeNull();
    expect(parseTimeOfDay('9:00')).toBeNull();
    expect(parseTimeOfDay('полдень')).toBeNull();
    expect(parseTimeOfDay('')).toBeNull();
  });
});

describe('mealTypeByTime', () => {
  it('раннее утро — перекус', () => {
    expect(mealTypeByTime('03:00')).toBe('SNACK');
  });

  it('завтрак', () => {
    expect(mealTypeByTime('08:00')).toBe('BREAKFAST');
  });

  it('обед', () => {
    expect(mealTypeByTime('13:00')).toBe('LUNCH');
  });

  it('ужин', () => {
    expect(mealTypeByTime('19:00')).toBe('DINNER');
  });

  it('поздний вечер — снова перекус', () => {
    expect(mealTypeByTime('23:30')).toBe('SNACK');
  });

  it('границы принадлежат следующему приёму', () => {
    expect(mealTypeByTime('04:59')).toBe('SNACK');
    expect(mealTypeByTime('05:00')).toBe('BREAKFAST');
    expect(mealTypeByTime('10:59')).toBe('BREAKFAST');
    expect(mealTypeByTime('11:00')).toBe('LUNCH');
    expect(mealTypeByTime('15:59')).toBe('LUNCH');
    expect(mealTypeByTime('16:00')).toBe('DINNER');
    expect(mealTypeByTime('21:59')).toBe('DINNER');
    expect(mealTypeByTime('22:00')).toBe('SNACK');
  });

  it('полночь — перекус', () => {
    expect(mealTypeByTime('00:00')).toBe('SNACK');
  });

  it('мусор на входе не превращается в завтрак', () => {
    expect(mealTypeByTime('обед')).toBeNull();
  });
});
