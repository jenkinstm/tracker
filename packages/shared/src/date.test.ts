import { describe, expect, it } from 'vitest';

import {
  dateColumnToIso,
  isIsoDate,
  isoToDateColumn,
  shiftIsoDate,
  toIsoDate,
  toTimeOfDay,
  todayIso,
} from './date.js';

describe('isIsoDate', () => {
  it('принимает корректную дату', () => {
    expect(isIsoDate('2026-07-28')).toBe(true);
  });

  it('отбрасывает мусор и неверный формат', () => {
    expect(isIsoDate('28.07.2026')).toBe(false);
    expect(isIsoDate('2026-7-8')).toBe(false);
    expect(isIsoDate('вчера')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });

  // Регулярку такая строка проходит, датой от этого не становится.
  it('отбрасывает несуществующие даты', () => {
    expect(isIsoDate('2026-02-31')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
  });

  it('високосный день принимается только в високосный год', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
  });
});

describe('toIsoDate', () => {
  // Главная причина, по которой зона передаётся явно: поздним вечером
  // московская дата уже завтрашняя относительно UTC.
  it('поздний вечер по Москве — это ещё сегодня, а не завтра по UTC', () => {
    const instant = new Date('2026-07-28T20:30:00Z'); // 23:30 в Москве
    expect(toIsoDate(instant, 'Europe/Moscow')).toBe('2026-07-28');
    expect(toIsoDate(instant, 'UTC')).toBe('2026-07-28');
  });

  it('после московской полуночи день уже новый, хотя в UTC ещё старый', () => {
    const instant = new Date('2026-07-28T21:30:00Z'); // 00:30 29-го в Москве
    expect(toIsoDate(instant, 'Europe/Moscow')).toBe('2026-07-29');
    expect(toIsoDate(instant, 'UTC')).toBe('2026-07-28');
  });

  it('по умолчанию считает по Москве', () => {
    const instant = new Date('2026-07-28T21:30:00Z');
    expect(toIsoDate(instant)).toBe('2026-07-29');
  });

  it('todayIso берёт переданный момент', () => {
    expect(todayIso('Europe/Moscow', new Date('2026-01-01T09:00:00Z'))).toBe('2026-01-01');
  });
});

describe('toTimeOfDay', () => {
  it('время в московском поясе', () => {
    expect(toTimeOfDay(new Date('2026-07-28T09:05:00Z'), 'Europe/Moscow')).toBe('12:05');
  });

  it('полночь печатается как 00:00, а не 24:00', () => {
    expect(toTimeOfDay(new Date('2026-07-28T21:00:00Z'), 'Europe/Moscow')).toBe('00:00');
  });
});

describe('колонка DATE', () => {
  // Prisma отдаёт DATE как полночь UTC. Перевод в местный пояс сдвинул бы день.
  it('значение колонки читается без сдвига', () => {
    expect(dateColumnToIso(new Date('2026-07-28T00:00:00.000Z'))).toBe('2026-07-28');
  });

  it('запись и чтение симметричны', () => {
    expect(dateColumnToIso(isoToDateColumn('2026-07-28'))).toBe('2026-07-28');
  });
});

describe('shiftIsoDate', () => {
  it('вперёд и назад на день', () => {
    expect(shiftIsoDate('2026-07-28', 1)).toBe('2026-07-29');
    expect(shiftIsoDate('2026-07-28', -1)).toBe('2026-07-27');
  });

  it('переход через границу месяца и года', () => {
    expect(shiftIsoDate('2026-07-31', 1)).toBe('2026-08-01');
    expect(shiftIsoDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftIsoDate('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('через високосный февраль', () => {
    expect(shiftIsoDate('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftIsoDate('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('нулевой сдвиг ничего не меняет', () => {
    expect(shiftIsoDate('2026-07-28', 0)).toBe('2026-07-28');
  });
});
