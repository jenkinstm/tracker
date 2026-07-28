import { todayIso } from '@tracker/shared';

import { prisma } from '../src/db.js';
import {
  createDiaryEntry,
  deleteDiaryEntry,
  getDiaryDay,
  setWaterGlasses,
  updateDiaryEntry,
} from '../src/lib/diary.js';
import { searchFoods } from '../src/lib/foodSearch.js';
import { getRecentFoods } from '../src/lib/recent.js';
import { getSingleUser } from '../src/lib/user.js';

/**
 * Проверка приёмки блока 4. Прогоняет путь дневника целиком: поиск →
 * добавление → недавние → правка → удаление, плюс вода.
 *
 * Созданные записи удаляются в конце — скрипт не должен оставлять мусор
 * в базе разработчика.
 */

let failed = false;

function check(label: string, condition: boolean, detail = '') {
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failed = true;
}

async function main() {
  const user = await getSingleUser();
  const date = todayIso();
  const created: string[] = [];

  console.log('── Поиск (FR-2.1)\n');

  const cyrillic = await searchFoods(user.id, 'гречка', 5);
  check('«гречка» находит продукт', cyrillic.length > 0, cyrillic[0]?.name);

  const wrongLayout = await searchFoods(user.id, 'uhtxrf', 5);
  check(
    '«uhtxrf» находит то же самое: учитывается раскладка',
    wrongLayout[0]?.id === cyrillic[0]?.id,
    wrongLayout[0]?.name,
  );

  const upper = await searchFoods(user.id, 'ТВОРОГ', 5);
  check('поиск регистронезависим', upper.length > 0, upper[0]?.name);

  const substring = await searchFoods(user.id, 'куриная грудка', 5);
  check('подстрочное совпадение работает', substring.length > 0, substring[0]?.name);

  const nothing = await searchFoods(user.id, 'абракадабра', 5);
  check('бессмысленный запрос ничего не находит', nothing.length === 0);

  console.log('\n── Добавление и итоги дня (FR-2.2, FR-2.3)\n');

  const buckwheat = cyrillic[0]!;
  const before = await getDiaryDay(user.id, date);

  const add = await createDiaryEntry(user.id, {
    date,
    time: '13:20',
    foodId: buckwheat.id,
    grams: 200,
  });
  check('запись добавлена', add.ok);

  let day = await getDiaryDay(user.id, date);
  const entry = day.entries.find((e) => e.time === '13:20' && e.foodId === buckwheat.id);
  if (entry) created.push(entry.id);

  check('запись видна в дне', entry !== undefined);
  check(
    'КБЖУ пересчитаны на 200 г',
    entry?.kcal === Math.round(buckwheat.kcal100 * 2 * 10) / 10,
    `${entry?.kcal} ккал при ${buckwheat.kcal100} на 100 г`,
  );
  check('тип приёма определён по времени 13:20', entry?.mealType === 'LUNCH', entry?.mealType ?? '');
  check(
    'итоги дня выросли на калорийность записи',
    Math.abs(day.totals.kcal - before.totals.kcal - (entry?.kcal ?? 0)) < 0.01,
    `${before.totals.kcal} → ${day.totals.kcal}`,
  );
  check(
    'остаток считается от нормы',
    day.remaining.kcal !== null,
    `${day.remaining.kcal} ккал осталось`,
  );

  console.log('\n── Недавние (FR-2.6)\n');

  const recent = await getRecentFoods(user.id);
  const inRecent = recent.recent.find((f) => f.id === buckwheat.id);
  check('продукт попал в недавние', inRecent !== undefined);
  check(
    'запомнен вес прошлого раза — добавление в один тап',
    inRecent?.lastGrams === 200,
    `${inRecent?.lastGrams} г`,
  );

  console.log('\n── Правка и удаление (FR-2.4)\n');

  const patched = await updateDiaryEntry(user.id, entry!.id, { grams: 100 });
  check('количество изменено', patched.ok);

  day = await getDiaryDay(user.id, date);
  const afterPatch = day.entries.find((e) => e.id === entry!.id);
  check(
    'КБЖУ пересчитаны от продукта, а не масштабированием снимка',
    afterPatch?.kcal === buckwheat.kcal100,
    `${afterPatch?.kcal} ккал за 100 г`,
  );

  const moved = await updateDiaryEntry(user.id, entry!.id, { time: '08:30', mealType: 'BREAKFAST' });
  check('время и тип приёма меняются', moved.ok);

  console.log('\n── Вода (FR-2.13)\n');

  const waterBefore = (await getDiaryDay(user.id, date)).water;
  await setWaterGlasses(user.id, date, 5);
  const waterAfter = (await getDiaryDay(user.id, date)).water;
  check(
    'счётчик стаканов сохраняется',
    waterAfter.glasses === 5,
    `${waterAfter.glasses} из ${waterAfter.target}`,
  );
  await setWaterGlasses(user.id, date, waterBefore.glasses);

  console.log('\n── Уборка\n');

  for (const id of created) await deleteDiaryEntry(user.id, id);
  const final = await getDiaryDay(user.id, date);
  check(
    'после удаления итоги вернулись к исходным',
    Math.abs(final.totals.kcal - before.totals.kcal) < 0.01,
    `${final.totals.kcal} ккал`,
  );
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
