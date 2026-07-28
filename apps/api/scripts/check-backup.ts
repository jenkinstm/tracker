import { backupSchema, todayIso, totalRecords } from '@tracker/shared';

import { prisma } from '../src/db.js';
import { exportData, importData } from '../src/lib/backup.js';
import { createDiaryEntry } from '../src/lib/diary.js';
import { getSingleUser } from '../src/lib/user.js';
import { upsertWeight } from '../src/lib/weight.js';
import { addSet, startWorkout } from '../src/lib/workout.js';

/**
 * Проверка приёмки блока 7, критерий №4: все данные восстанавливаются
 * из JSON-экспорта без потерь.
 *
 * Скрипт создаёт набор данных во всех разделах, выгружает, стирает,
 * восстанавливает и сверяет выгрузки побайтово. В конце возвращает базу
 * к исходному состоянию — включая данные, которые были до запуска.
 */

let failed = false;

function check(label: string, condition: boolean, detail = '') {
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failed = true;
}

async function main() {
  const user = await getSingleUser();
  const today = todayIso();

  // Всё, что было до запуска, — вернём в самом конце.
  const original = await exportData(user.id);
  console.log(`Исходных записей в базе: ${totalRecords(original)}\n`);

  try {
    console.log('── Готовим данные во всех разделах\n');

    const ownFood = await prisma.food.create({
      data: {
        userId: user.id,
        name: 'Проверочный продукт',
        kcal100: 100,
        protein100: 10,
        fat100: 5,
        carb100: 5,
        defaultPortionG: 150,
        source: 'OWN',
      },
    });
    await prisma.foodUnit.create({
      data: { foodId: ownFood.id, unitName: '1 шт', grams: 75 },
    });

    await createDiaryEntry(user.id, { date: today, time: '09:00', foodId: ownFood.id, grams: 150 });
    await createDiaryEntry(user.id, {
      date: today,
      time: '13:30',
      foodId: 'seed:buckwheat-boiled',
      grams: 200,
    });

    await upsertWeight(user.id, today, 123.4);
    await prisma.daily.upsert({
      where: { userId_date: { userId: user.id, date: new Date(`${today}T00:00:00.000Z`) } },
      create: { userId: user.id, date: new Date(`${today}T00:00:00.000Z`), steps: 9100, waterGlasses: 7 },
      update: { steps: 9100, waterGlasses: 7 },
    });

    const program = await prisma.program.findFirst({ where: { userId: user.id } });
    const started = await startWorkout(user.id, today, program?.id ?? null);
    if (started.ok && !program) {
      await addSet(user.id, started.id, 'seed:goblet-squat', { weightKg: 40, reps: 10, done: true });
    }

    const before = await exportData(user.id);
    console.log(`Записей после подготовки: ${totalRecords(before)}\n`);

    console.log('── Выгрузка (FR-8.1)\n');

    const parsed = backupSchema.safeParse(before);
    check('выгрузка проходит собственную схему', parsed.success);
    check('версия формата проставлена', before.version === 1, `${before.version}`);
    check('дата выгрузки проставлена', before.exportedAt.length > 0, before.exportedAt);
    check('профиль выгружен', before.profile !== null);
    check('свой продукт выгружен', before.foods.length > 0, `${before.foods.length}`);
    check('штучные единицы выгружены', before.foodUnits.length > 0, `${before.foodUnits.length}`);
    check('записи дневника выгружены', before.diaryEntries.length >= 2, `${before.diaryEntries.length}`);
    check('вес выгружен', before.weights.length > 0, `${before.weights.length}`);
    check('тренировка выгружена', before.workouts.length > 0, `${before.workouts.length}`);
    check('подходы выгружены', before.workoutSets.length > 0, `${before.workoutSets.length}`);
    check('день с шагами и водой выгружен', before.daily.length > 0, `${before.daily.length}`);

    // Справочник не должен раздувать файл — его вернёт сидер.
    const seedFoodInExport = before.foods.some((food) => food.id.startsWith('seed:'));
    check('сидовые продукты в выгрузку не попали', !seedFoodInExport);

    const referencesSeed = before.diaryEntries.some((e) => e.foodId?.startsWith('seed:'));
    check('ссылки на сидовые продукты сохранены', referencesSeed);

    console.log('\n── Восстановление в пустую инсталляцию (критерий приёмки №4)\n');

    const refused = await importData(user.id, before);
    check(
      'импорт поверх непустой базы отклонён',
      !refused.ok && refused.error === 'not_empty',
      refused.ok ? 'прошёл' : refused.error,
    );

    const restored = await importData(user.id, before, { replace: true });
    check('импорт с явным замещением прошёл', restored.ok);

    const after = await exportData(user.id);

    check(
      'число записей совпадает',
      totalRecords(after) === totalRecords(before),
      `${totalRecords(before)} → ${totalRecords(after)}`,
    );

    // Сравниваем всё, кроме отметки времени самой выгрузки.
    const normalize = (backup: typeof before) => JSON.stringify({ ...backup, exportedAt: '' });
    check('выгрузка после восстановления идентична исходной', normalize(after) === normalize(before));

    const entry = after.diaryEntries.find((e) => e.foodId === 'seed:buckwheat-boiled');
    check(
      'КБЖУ записи дневника уцелели',
      entry?.kcal === 184 && entry?.protein === 6.8,
      `${entry?.kcal} ккал, Б ${entry?.protein}`,
    );

    const weight = after.weights.find((w) => w.date === today);
    check('вес уцелел', weight?.kg === 123.4, `${weight?.kg} кг`);

    const daily = after.daily.find((d) => d.date === today);
    check('шаги и вода уцелели', daily?.steps === 9100 && daily?.waterGlasses === 7);

    console.log('\n── Отказы\n');

    const fromFuture = await importData(user.id, { ...before, version: 99 }, { replace: true });
    check(
      'выгрузка из будущей версии не читается',
      !fromFuture.ok && fromFuture.error === 'unsupported_version',
    );
  } finally {
    console.log('\n── Возврат исходного состояния\n');

    await importData(user.id, original, { replace: true });
    const final = await exportData(user.id);

    check(
      'база вернулась к тому, что было до запуска',
      totalRecords(final) === totalRecords(original),
      `${totalRecords(final)} записей`,
    );
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    if (failed) process.exit(1);
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
