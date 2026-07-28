import { describe, expect, it } from 'vitest';

import { queryVariants, switchLayout } from './layout.js';

describe('switchLayout', () => {
  it('латиница → кириллица', () => {
    expect(switchLayout('uhtxrf')).toBe('гречка');
    expect(switchLayout('ndjhju')).toBe('творог');
  });

  it('кириллица → латиница', () => {
    expect(switchLayout('гречка')).toBe('uhtxrf');
  });

  it('перевод обратим', () => {
    expect(switchLayout(switchLayout('куриная')!)).toBe('куриная');
  });

  it('регистр сохраняется', () => {
    expect(switchLayout('Uhtxrf')).toBe('Гречка');
  });

  it('пробелы и цифры не трогаются', () => {
    expect(switchLayout('rehbyfz uhelrf')).toBe('куриная грудка');
    expect(switchLayout('vjkjrj 2')).toBe('молоко 2');
  });

  // Буквы х, ъ, ж, э, б, ю живут на клавишах со знаками препинания.
  // Без них не собрать «хлеб» из «[ke,», а это обычный запрос.
  it('переводит буквы, лежащие на знаках препинания', () => {
    expect(switchLayout('[kt,')).toBe('хлеб');
    expect(switchLayout(';bhysq')).toBe('жирный');
    expect(switchLayout('хлеб')).toBe('[kt,');
  });

  it('строке без переводимых символов возвращается null', () => {
    expect(switchLayout('2024')).toBeNull();
    expect(switchLayout('')).toBeNull();
  });

  it('смешанная строка определяется как кириллическая', () => {
    // Есть хоть одна кириллическая буква — значит переводим в латиницу.
    expect(switchLayout('гречка 100')).toBe('uhtxrf 100');
  });
});

describe('queryVariants', () => {
  it('даёт оба варианта для запроса не в той раскладке', () => {
    expect(queryVariants('uhtxrf')).toEqual(['uhtxrf', 'гречка']);
  });

  it('не дублирует запрос, если переводить нечего', () => {
    expect(queryVariants('100')).toEqual(['100']);
  });

  it('обрезает пробелы по краям', () => {
    expect(queryVariants('  творог  ')).toEqual(['творог', 'ndjhju']);
  });

  it('пустой запрос не даёт вариантов', () => {
    expect(queryVariants('')).toEqual([]);
    expect(queryVariants('   ')).toEqual([]);
  });
});
