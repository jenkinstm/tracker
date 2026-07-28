import { prisma } from '../src/db.js';

/**
 * Проверка приёмки блока 2: поиск по залитой базе находит опорные продукты
 * с адекватными КБЖУ. Полноценный поиск — это FR-2.1 и блок 4, здесь только
 * запрос к БД, чтобы убедиться, что сид на месте и триграммный индекс работает.
 */

const QUERIES = ['гречка', 'творог', 'куриная грудка', 'жим гантелей'];

type FoodRow = {
  name: string;
  kcal_100: number;
  protein_100: number;
  fat_100: number;
  carb_100: number;
  default_portion_g: number | null;
};

async function searchFoods(query: string) {
  // Подстрочный поиск как основной, триграммное сходство — чтобы находилось
  // при опечатке и другом окончании («гречка» → «гречневая лапша»).
  return prisma.$queryRaw<FoodRow[]>`
    SELECT name, kcal_100, protein_100, fat_100, carb_100, default_portion_g
    FROM foods
    WHERE name ILIKE '%' || ${query} || '%' OR similarity(name, ${query}) > 0.3
    ORDER BY (name ILIKE '%' || ${query} || '%') DESC, similarity(name, ${query}) DESC
    LIMIT 5
  `;
}

async function main() {
  const [foodCount, unitCount, exerciseCount, programCount, itemCount] = await Promise.all([
    prisma.food.count({ where: { source: 'SEED' } }),
    prisma.foodUnit.count(),
    prisma.exercise.count({ where: { userId: null } }),
    prisma.program.count(),
    prisma.programItem.count(),
  ]);

  // Счётчики печатаются в том числе чтобы поймать неидемпотентную заливку:
  // после повторного запуска сидера цифры обязаны остаться прежними.
  console.log(
    `В базе: ${foodCount} продуктов (${unitCount} штучных единиц), ` +
      `${exerciseCount} упражнений, ${programCount} программ (${itemCount} упражнений в них)\n`,
  );

  let failed = false;

  for (const query of QUERIES) {
    const exercises = await prisma.exercise.findMany({
      where: { userId: null, name: { contains: query, mode: 'insensitive' } },
      take: 5,
    });
    const rows = exercises.length > 0 ? [] : await searchFoods(query);

    if (rows.length === 0 && exercises.length === 0) {
      console.error(`✗ «${query}» — ничего не найдено`);
      failed = true;
      continue;
    }

    console.log(`✓ «${query}»`);
    for (const r of rows) {
      const portion = r.default_portion_g ? `, порция ${r.default_portion_g} г` : '';
      console.log(
        `    ${r.name} — ${r.kcal_100} ккал, Б ${r.protein_100} / Ж ${r.fat_100} / У ${r.carb_100} на 100 г${portion}`,
      );
    }
    for (const e of exercises) {
      console.log(`    ${e.name} — ${e.muscleGroup}, ${e.equipment}, отдых ${e.restSec} с`);
    }
    console.log('');
  }

  const withPrograms = await prisma.program.findMany({
    include: { items: { include: { exercise: true }, orderBy: { order: 'asc' } } },
    orderBy: { name: 'asc' },
  });

  for (const p of withPrograms) {
    console.log(`${p.name}: ${p.items.map((i) => i.exercise.name).join(', ')}`);
  }

  if (failed) process.exit(1);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
