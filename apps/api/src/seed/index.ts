import { prisma } from '../db.js';
import { getSingleUser } from '../lib/user.js';
import { exercises } from './exercises.js';
import { foods } from './foods.js';
import { seedProfileDefaults } from './profile.js';
import { programs } from './programs.js';
import { seedExerciseSchema, seedFoodSchema, seedId, seedProgramSchema } from './types.js';

/**
 * Заливка сида. Идемпотентна: id детерминированные, повторный запуск обновляет
 * строки. Гоняется на каждом старте контейнера — правка в файле данных доезжает
 * до базы без ручных шагов.
 */

function validate() {
  for (const f of foods) seedFoodSchema.parse(f);
  for (const e of exercises) seedExerciseSchema.parse(e);
  for (const p of programs) seedProgramSchema.parse(p);

  const known = new Set(exercises.map((e) => e.id));
  for (const p of programs) {
    for (const item of p.items) {
      if (!known.has(item.exerciseId)) {
        throw new Error(`Программа ${p.id} ссылается на неизвестное упражнение ${item.exerciseId}`);
      }
    }
  }
}

async function seedFoods() {
  for (const f of foods) {
    const id = seedId(f.id);
    const data = {
      userId: null,
      name: f.name,
      kcal100: f.kcal,
      protein100: f.protein,
      fat100: f.fat,
      carb100: f.carb,
      fiber100: f.fiber ?? null,
      defaultPortionG: f.portion,
      isSweet: f.isSweet ?? false,
      source: 'SEED' as const,
    };

    await prisma.food.upsert({ where: { id }, create: { id, ...data }, update: data });

    // Единицы задаются целиком: убранная из файла единица должна исчезнуть и в БД.
    await prisma.foodUnit.deleteMany({
      where: { foodId: id, unitName: { notIn: (f.units ?? []).map((u) => u.name) } },
    });
    for (const u of f.units ?? []) {
      await prisma.foodUnit.upsert({
        where: { foodId_unitName: { foodId: id, unitName: u.name } },
        create: { foodId: id, unitName: u.name, grams: u.grams },
        update: { grams: u.grams },
      });
    }
  }

  // Позиции, выброшенные из файла. Те, что уже попали в дневник или рецепт,
  // не трогаем: история важнее чистоты справочника.
  const removed = await prisma.food.deleteMany({
    where: {
      source: 'SEED',
      userId: null,
      id: { notIn: foods.map((f) => seedId(f.id)) },
      diaryEntries: { none: {} },
      recipeItems: { none: {} },
    },
  });

  return { upserted: foods.length, removed: removed.count };
}

async function seedExercises() {
  for (const e of exercises) {
    const id = seedId(e.id);
    const data = {
      userId: null,
      name: e.name,
      muscleGroup: e.muscleGroup,
      equipment: e.equipment,
      isCardio: e.isCardio ?? false,
      restSec: e.restSec,
    };

    await prisma.exercise.upsert({ where: { id }, create: { id, ...data }, update: data });
  }

  const removed = await prisma.exercise.deleteMany({
    where: {
      userId: null,
      id: { notIn: exercises.map((e) => seedId(e.id)) },
      programItems: { none: {} },
      sets: { none: {} },
    },
  });

  return { upserted: exercises.length, removed: removed.count };
}

async function seedPrograms(userId: string) {
  for (const p of programs) {
    const id = seedId(p.id);

    await prisma.program.upsert({
      where: { id },
      create: { id, userId, name: p.name },
      update: { name: p.name },
    });

    // Состав программы задаётся файлом целиком — проще перезаписать, чем
    // сверять порядок построчно. Свои программы пользователя это не трогает.
    await prisma.programItem.deleteMany({ where: { programId: id } });
    await prisma.programItem.createMany({
      data: p.items.map((item, index) => ({
        programId: id,
        exerciseId: seedId(item.exerciseId),
        order: index + 1,
        targetSets: item.targetSets,
        targetReps: item.targetReps,
      })),
    });
  }

  return { upserted: programs.length };
}

async function main() {
  validate();

  const user = await getSingleUser();

  const f = await seedFoods();
  const e = await seedExercises();
  const p = await seedPrograms(user.id);
  const filled = await seedProfileDefaults(user.id);

  console.log(`Продукты:   ${f.upserted} записано, ${f.removed} устаревших удалено`);
  console.log(`Упражнения: ${e.upserted} записано, ${e.removed} устаревших удалено`);
  console.log(`Программы:  ${p.upserted} записано`);
  console.log(
    filled.length > 0
      ? `Профиль:    дефолты проставлены в ${filled.join(', ')}`
      : 'Профиль:    заполнен, дефолты не трогались',
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('Сид не залился:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
