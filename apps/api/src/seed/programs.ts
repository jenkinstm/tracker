import type { SeedProgram } from './types.js';

/**
 * Три программы по умолчанию из `docs/context.md` (FR-5.2).
 * Чередуются A → B → C, каждая на всё тело, пять упражнений.
 *
 * `targetReps: null` там, где повторы не считаются: планка и переноска мешка
 * меряются секундами и метрами.
 */
export const programs: SeedProgram[] = [
  {
    id: 'program-a',
    name: 'Программа A',
    items: [
      { exerciseId: 'goblet-squat', targetSets: 4, targetReps: 10 },
      { exerciseId: 'db-bench-press', targetSets: 4, targetReps: 10 },
      { exerciseId: 'db-row', targetSets: 4, targetReps: 12 },
      { exerciseId: 'hyperextension', targetSets: 3, targetReps: 15 },
      { exerciseId: 'plank', targetSets: 3, targetReps: null },
    ],
  },
  {
    id: 'program-b',
    name: 'Программа B',
    items: [
      { exerciseId: 'romanian-deadlift', targetSets: 4, targetReps: 10 },
      { exerciseId: 'db-shoulder-press', targetSets: 4, targetReps: 10 },
      { exerciseId: 'barbell-row', targetSets: 4, targetReps: 10 },
      { exerciseId: 'lunges-db', targetSets: 3, targetReps: 12 },
      { exerciseId: 'crunches', targetSets: 3, targetReps: 20 },
    ],
  },
  {
    id: 'program-c',
    name: 'Программа C',
    items: [
      { exerciseId: 'back-squat', targetSets: 4, targetReps: 8 },
      { exerciseId: 'pushups-elevated', targetSets: 4, targetReps: 12 },
      { exerciseId: 'band-face-pull', targetSets: 3, targetReps: 15 },
      { exerciseId: 'glute-bridge', targetSets: 3, targetReps: 15 },
      { exerciseId: 'sandbag-carry', targetSets: 3, targetReps: null },
    ],
  },
];
