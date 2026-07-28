import type { SeedExercise } from './types.js';

/**
 * Библиотека упражнений под домашний инвентарь (FR-5.1): гантели, штанга,
 * мешок, гиперэкстензия, резинки, фитбол. Тренажёрный зал в сид не идёт —
 * такие упражнения заводятся вручную, если понадобятся.
 *
 * `restSec` — отдых по умолчанию, база для таймера (FR-5.5). Тяжёлые
 * многосуставные — дольше, изоляция и корпус — короче.
 */
export const exercises: SeedExercise[] = [
  // ─────────────────────────────────────────── ноги и ягодицы
  { id: 'goblet-squat', name: 'Гоблет-присед с гантелью', muscleGroup: 'LEGS', equipment: 'DUMBBELL', restSec: 120 },
  { id: 'back-squat', name: 'Приседания со штангой', muscleGroup: 'LEGS', equipment: 'BARBELL', restSec: 150 },
  { id: 'front-squat', name: 'Фронтальные приседания со штангой', muscleGroup: 'LEGS', equipment: 'BARBELL', restSec: 150 },
  { id: 'sandbag-squat', name: 'Присед с мешком', muscleGroup: 'LEGS', equipment: 'SANDBAG', restSec: 120 },
  { id: 'romanian-deadlift', name: 'Румынская тяга со штангой', muscleGroup: 'GLUTES', equipment: 'BARBELL', restSec: 150 },
  { id: 'romanian-deadlift-db', name: 'Румынская тяга с гантелями', muscleGroup: 'GLUTES', equipment: 'DUMBBELL', restSec: 120 },
  { id: 'deadlift', name: 'Становая тяга', muscleGroup: 'BACK', equipment: 'BARBELL', restSec: 180 },
  { id: 'lunges-db', name: 'Выпады с гантелями', muscleGroup: 'LEGS', equipment: 'DUMBBELL', restSec: 120 },
  { id: 'reverse-lunges', name: 'Обратные выпады', muscleGroup: 'LEGS', equipment: 'BODYWEIGHT', restSec: 90 },
  { id: 'bulgarian-split-squat', name: 'Болгарский присед', muscleGroup: 'LEGS', equipment: 'DUMBBELL', restSec: 120 },
  { id: 'step-up', name: 'Зашагивания на возвышение', muscleGroup: 'LEGS', equipment: 'DUMBBELL', restSec: 90 },
  { id: 'wall-sit', name: 'Присед у стены', muscleGroup: 'LEGS', equipment: 'BODYWEIGHT', restSec: 60 },
  { id: 'calf-raise', name: 'Подъём на носки с гантелями', muscleGroup: 'LEGS', equipment: 'DUMBBELL', restSec: 60 },
  { id: 'glute-bridge', name: 'Ягодичный мостик', muscleGroup: 'GLUTES', equipment: 'BODYWEIGHT', restSec: 90 },
  { id: 'hip-thrust-barbell', name: 'Ягодичный мостик со штангой', muscleGroup: 'GLUTES', equipment: 'BARBELL', restSec: 120 },
  { id: 'band-abduction', name: 'Отведение ноги с резинкой', muscleGroup: 'GLUTES', equipment: 'BAND', restSec: 60 },

  // ─────────────────────────────────────────── грудь
  { id: 'db-bench-press', name: 'Жим гантелей лёжа', muscleGroup: 'CHEST', equipment: 'DUMBBELL', restSec: 120 },
  { id: 'barbell-bench-press', name: 'Жим штанги лёжа', muscleGroup: 'CHEST', equipment: 'BARBELL', restSec: 150 },
  { id: 'db-fly', name: 'Разведение гантелей лёжа', muscleGroup: 'CHEST', equipment: 'DUMBBELL', restSec: 90 },
  { id: 'db-pullover', name: 'Пуловер с гантелью', muscleGroup: 'CHEST', equipment: 'DUMBBELL', restSec: 90 },
  { id: 'pushups', name: 'Отжимания от пола', muscleGroup: 'CHEST', equipment: 'BODYWEIGHT', restSec: 90 },
  { id: 'pushups-elevated', name: 'Отжимания с возвышения', muscleGroup: 'CHEST', equipment: 'BODYWEIGHT', restSec: 90 },
  { id: 'fitball-pushups', name: 'Отжимания с руками на фитболе', muscleGroup: 'CHEST', equipment: 'FITBALL', restSec: 90 },

  // ─────────────────────────────────────────── спина
  { id: 'db-row', name: 'Тяга гантели в наклоне', muscleGroup: 'BACK', equipment: 'DUMBBELL', restSec: 120 },
  { id: 'barbell-row', name: 'Тяга штанги в наклоне', muscleGroup: 'BACK', equipment: 'BARBELL', restSec: 120 },
  { id: 'sandbag-row', name: 'Тяга мешка в наклоне', muscleGroup: 'BACK', equipment: 'SANDBAG', restSec: 120 },
  { id: 'band-row', name: 'Тяга резинки к поясу', muscleGroup: 'BACK', equipment: 'BAND', restSec: 90 },
  { id: 'band-pulldown', name: 'Тяга резинки сверху', muscleGroup: 'BACK', equipment: 'BAND', restSec: 90 },
  { id: 'hyperextension', name: 'Гиперэкстензия', muscleGroup: 'BACK', equipment: 'HYPEREXTENSION', restSec: 90 },
  { id: 'reverse-hyperextension', name: 'Обратная гиперэкстензия', muscleGroup: 'GLUTES', equipment: 'HYPEREXTENSION', restSec: 90 },

  // ─────────────────────────────────────────── плечи и руки
  { id: 'db-shoulder-press', name: 'Жим гантелей стоя', muscleGroup: 'SHOULDERS', equipment: 'DUMBBELL', restSec: 120 },
  { id: 'barbell-overhead-press', name: 'Жим штанги стоя', muscleGroup: 'SHOULDERS', equipment: 'BARBELL', restSec: 150 },
  { id: 'db-lateral-raise', name: 'Махи гантелями в стороны', muscleGroup: 'SHOULDERS', equipment: 'DUMBBELL', restSec: 60 },
  { id: 'db-front-raise', name: 'Подъём гантелей перед собой', muscleGroup: 'SHOULDERS', equipment: 'DUMBBELL', restSec: 60 },
  { id: 'band-face-pull', name: 'Тяга резинки к лицу', muscleGroup: 'SHOULDERS', equipment: 'BAND', restSec: 60 },
  { id: 'db-curl', name: 'Подъём гантелей на бицепс', muscleGroup: 'ARMS', equipment: 'DUMBBELL', restSec: 90 },
  { id: 'barbell-curl', name: 'Подъём штанги на бицепс', muscleGroup: 'ARMS', equipment: 'BARBELL', restSec: 90 },
  { id: 'band-curl', name: 'Сгибание рук с резинкой', muscleGroup: 'ARMS', equipment: 'BAND', restSec: 60 },
  { id: 'db-french-press', name: 'Французский жим с гантелью', muscleGroup: 'ARMS', equipment: 'DUMBBELL', restSec: 90 },
  { id: 'bench-dips', name: 'Обратные отжимания от скамьи', muscleGroup: 'ARMS', equipment: 'BODYWEIGHT', restSec: 90 },

  // ─────────────────────────────────────────── корпус
  { id: 'plank', name: 'Планка', muscleGroup: 'CORE', equipment: 'BODYWEIGHT', restSec: 60 },
  { id: 'side-plank', name: 'Боковая планка', muscleGroup: 'CORE', equipment: 'BODYWEIGHT', restSec: 60 },
  { id: 'crunches', name: 'Скручивания', muscleGroup: 'CORE', equipment: 'BODYWEIGHT', restSec: 60 },
  { id: 'leg-raises', name: 'Подъём ног лёжа', muscleGroup: 'CORE', equipment: 'BODYWEIGHT', restSec: 60 },
  { id: 'deadbug', name: 'Упражнение «мёртвый жук»', muscleGroup: 'CORE', equipment: 'BODYWEIGHT', restSec: 60 },
  { id: 'fitball-crunch', name: 'Скручивания на фитболе', muscleGroup: 'CORE', equipment: 'FITBALL', restSec: 60 },
  { id: 'russian-twist', name: 'Русский твист с гантелью', muscleGroup: 'CORE', equipment: 'DUMBBELL', restSec: 60 },

  // ─────────────────────────────────────────── всё тело и кардио
  { id: 'sandbag-clean', name: 'Взятие мешка на грудь', muscleGroup: 'FULL_BODY', equipment: 'SANDBAG', restSec: 120 },
  { id: 'sandbag-carry', name: 'Ходьба с мешком', muscleGroup: 'FULL_BODY', equipment: 'SANDBAG', restSec: 120 },
  { id: 'db-swing', name: 'Махи гантелью между ног', muscleGroup: 'FULL_BODY', equipment: 'DUMBBELL', restSec: 90 },
  { id: 'burpee', name: 'Бёрпи', muscleGroup: 'FULL_BODY', equipment: 'BODYWEIGHT', restSec: 90 },
  { id: 'jump-rope', name: 'Скакалка', muscleGroup: 'CARDIO', equipment: 'CARDIO', isCardio: true, restSec: 60 },
  { id: 'running', name: 'Бег', muscleGroup: 'CARDIO', equipment: 'CARDIO', isCardio: true, restSec: 60 },
  { id: 'walking', name: 'Ходьба', muscleGroup: 'CARDIO', equipment: 'CARDIO', isCardio: true, restSec: 60 },
];
