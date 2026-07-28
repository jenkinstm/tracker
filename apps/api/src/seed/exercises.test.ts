import { describe, expect, it } from 'vitest';
import { exercises } from './exercises.js';
import { programs } from './programs.js';
import { seedExerciseSchema, seedProgramSchema } from './types.js';

describe('сид упражнений', () => {
  it('каждое упражнение проходит схему', () => {
    for (const e of exercises) {
      const result = seedExerciseSchema.safeParse(e);
      expect(result.success, `${e.id}: ${result.error?.message}`).toBe(true);
    }
  });

  it('id и названия уникальны', () => {
    expect(new Set(exercises.map((e) => e.id)).size).toBe(exercises.length);
    expect(new Set(exercises.map((e) => e.name.toLocaleLowerCase('ru'))).size).toBe(exercises.length);
  });

  it('кардио помечено и по оборудованию, и по группе мышц', () => {
    for (const e of exercises) {
      if (!e.isCardio) continue;
      expect(e.equipment, e.id).toBe('CARDIO');
      expect(e.muscleGroup, e.id).toBe('CARDIO');
    }
  });

  // Инвентарь из docs/context.md. Упражнения на зал в сид не идут.
  it('используется только домашний инвентарь', () => {
    const home = new Set(['BARBELL', 'DUMBBELL', 'BAND', 'BODYWEIGHT', 'SANDBAG', 'FITBALL', 'HYPEREXTENSION', 'CARDIO']);
    const bad = exercises.filter((e) => !home.has(e.equipment)).map((e) => `${e.id}: ${e.equipment}`);
    expect(bad).toEqual([]);
  });
});

describe('сид программ', () => {
  it('каждая программа проходит схему', () => {
    for (const p of programs) {
      const result = seedProgramSchema.safeParse(p);
      expect(result.success, `${p.id}: ${result.error?.message}`).toBe(true);
    }
  });

  it('три программы по пять упражнений', () => {
    expect(programs).toHaveLength(3);
    for (const p of programs) expect(p.items, p.id).toHaveLength(5);
  });

  it('все упражнения программ есть в библиотеке', () => {
    const known = new Set(exercises.map((e) => e.id));
    const bad = programs.flatMap((p) => p.items.filter((i) => !known.has(i.exerciseId)).map((i) => `${p.id}: ${i.exerciseId}`));
    expect(bad).toEqual([]);
  });

  it('внутри программы упражнения не повторяются', () => {
    for (const p of programs) {
      const ids = p.items.map((i) => i.exerciseId);
      expect(new Set(ids).size, p.id).toBe(ids.length);
    }
  });
});
