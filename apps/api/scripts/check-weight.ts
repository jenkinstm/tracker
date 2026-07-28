import { calcRate, calcTrendSeries, shiftIsoDate, todayIso } from '@tracker/shared';

import { prisma } from '../src/db.js';
import { getSingleUser } from '../src/lib/user.js';
import { deleteWeight, getWeightStats, upsertWeight } from '../src/lib/weight.js';

/**
 * Проверка приёмки блока 5, критерии №2 и №6.
 *
 * Скрипт пишет замеры за прошлые даты, проверяет тренд, темп и прогноз,
 * отдельно — поведение при разрывах в данных, и убирает всё за собой.
 * Уже имеющиеся замеры за те же даты сохраняются и восстанавливаются.
 */

let failed = false;

function check(label: string, condition: boolean, detail = '') {
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failed = true;
}

async function main() {
  const user = await getSingleUser();
  const today = todayIso();

  const existing = await prisma.weight.findMany({ where: { userId: user.id } });
  if (existing.length > 0) {
    console.log(`В базе уже ${existing.length} замеров — сохраню и верну на место.\n`);
    await prisma.weight.deleteMany({ where: { userId: user.id } });
  }

  try {
    console.log('── Запись веса (FR-4.1)\n');

    await upsertWeight(user.id, today, 124.0);
    let stats = (await getWeightStats(user.id, today)).stats;
    check('замер сохранён', stats.latest?.kg === 124, `${stats.latest?.kg} кг`);

    await upsertWeight(user.id, today, 123.5);
    stats = (await getWeightStats(user.id, today)).stats;
    const count = await prisma.weight.count({ where: { userId: user.id } });
    check('повторная запись перезаписывает, а не добавляет', count === 1, `${count} строка`);
    check('вес обновился', stats.latest?.kg === 123.5, `${stats.latest?.kg} кг`);

    await prisma.weight.deleteMany({ where: { userId: user.id } });

    console.log('\n── Тренд и темп на ровных данных (FR-4.2, FR-4.4)\n');

    // 21 день ровного снижения по 100 г в сутки — это 0.7 кг в неделю.
    for (let offset = 20; offset >= 0; offset -= 1) {
      await upsertWeight(user.id, shiftIsoDate(today, -offset), 124 - (20 - offset) * 0.1);
    }

    const series = await getWeightStats(user.id, today);
    stats = series.stats;

    check('ряд построен по календарю', series.points.length === 21, `${series.points.length} дней`);
    check(
      'тренд отстаёт от сырого веса при снижении',
      stats.trend !== null && stats.latest !== null && stats.trend > stats.latest.kg,
      `тренд ${stats.trend}, замер ${stats.latest?.kg}`,
    );
    check(
      'темп около −0.7 кг/нед',
      stats.ratePerWeek !== null && Math.abs(stats.ratePerWeek + 0.7) < 0.01,
      `${stats.ratePerWeek} кг/нед`,
    );
    check(
      'темп в процентах от массы тела посчитан',
      stats.ratePercent !== null,
      `${stats.ratePercent} %/нед`,
    );
    check(
      'коридор 0.5–1.0 % определён',
      stats.rateInCorridor === true,
      `${stats.ratePercent} % внутри коридора`,
    );

    console.log('\n── Прогноз (FR-4.5)\n');

    check(
      'прогноз даты выдан',
      stats.forecast.kind === 'ETA',
      stats.forecast.kind === 'ETA'
        ? `${stats.forecast.date}, ${stats.forecast.weeks} нед`
        : stats.forecast.kind,
    );
    check(
      'остаток до цели считается от тренда',
      stats.toGoalKg !== null,
      `${stats.toGoalKg} кг до ${stats.goalWeight}`,
    );

    console.log('\n── Разрывы в данных (критерий приёмки №6)\n');

    await prisma.weight.deleteMany({ where: { userId: user.id } });

    // Три замера подряд и один через 18 дней. Если считать по индексам
    // массива, а не по датам, темп улетает примерно к −21 кг/нед.
    const gapped = [
      { date: shiftIsoDate(today, -20), kg: 100 },
      { date: shiftIsoDate(today, -19), kg: 100 },
      { date: shiftIsoDate(today, -18), kg: 100 },
      { date: today, kg: 90 },
    ];
    for (const m of gapped) await upsertWeight(user.id, m.date, m.kg);

    const gappedSeries = await getWeightStats(user.id, today);

    check(
      'пропущенные дни есть в ряду',
      gappedSeries.points.length === 21,
      `${gappedSeries.points.length} точек на 4 замера`,
    );
    check(
      'дни без взвешивания не выдумывают вес',
      gappedSeries.points[10]?.kg === null,
      `середина разрыва: ${gappedSeries.points[10]?.kg}`,
    );
    check(
      'тренд в разрыве переносится, а не обнуляется',
      gappedSeries.points[10]?.trend === 100,
      `${gappedSeries.points[10]?.trend}`,
    );
    check(
      'темп не завышен сжатой шкалой',
      gappedSeries.stats.ratePerWeek !== null && gappedSeries.stats.ratePerWeek > -5,
      `${gappedSeries.stats.ratePerWeek} кг/нед (по индексам вышло бы около −21)`,
    );

    // Та же проверка на чистых функциях, без базы.
    const pureRate = calcRate(gapped, today);
    check(
      'расчёт из shared даёт то же значение',
      pureRate === gappedSeries.stats.ratePerWeek,
      `${pureRate}`,
    );
    check(
      'ряд из shared совпадает с рядом из API',
      calcTrendSeries(gapped).length === gappedSeries.points.length,
    );

    console.log('\n── Мало данных\n');

    await prisma.weight.deleteMany({ where: { userId: user.id } });
    await upsertWeight(user.id, today, 124);

    const single = (await getWeightStats(user.id, today)).stats;
    check('один замер: тренд есть', single.trend === 124, `${single.trend}`);
    check('один замер: темпа нет (FR-4.4)', single.ratePerWeek === null);
    check('один замер: прогноза нет', single.forecast.kind === 'NO_DATA', single.forecast.kind);

    await prisma.weight.deleteMany({ where: { userId: user.id } });
    const empty = (await getWeightStats(user.id, today)).stats;
    check('без замеров ничего не считается и не падает', empty.trend === null);
  } finally {
    console.log('\n── Уборка\n');

    await prisma.weight.deleteMany({ where: { userId: user.id } });
    for (const row of existing) {
      await upsertWeight(user.id, row.date.toISOString().slice(0, 10), row.kg);
    }

    const restored = await prisma.weight.count({ where: { userId: user.id } });
    check('исходные замеры на месте', restored === existing.length, `${restored}`);
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
