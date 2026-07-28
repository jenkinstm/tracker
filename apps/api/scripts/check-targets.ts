import { prisma } from '../src/db.js';
import { getProfileResponse } from '../src/lib/profile.js';
import { getSingleUser } from '../src/lib/user.js';

/**
 * Проверка приёмки блока 3: цифры из API совпадают с ручным расчётом
 * по формулам из docs/context.md. Формулы покрыты юнит-тестами в
 * packages/shared, здесь проверяется связка «БД → расчёт → ответ».
 */

function line(label: string, value: number | null, unit = '') {
  console.log(`  ${label.padEnd(22)} ${value === null ? '—' : value}${value === null ? '' : unit}`);
}

async function main() {
  const user = await getSingleUser();
  const response = await getProfileResponse(user.id);

  console.log('Профиль:');
  console.log(`  ${'пол'.padEnd(22)} ${response.profile.sex ?? '—'}`);
  line('год рождения', response.profile.birthYear);
  line('рост', response.profile.heightCm, ' см');
  line('стартовый вес', response.profile.startWeight, ' кг');
  line('целевой вес', response.profile.goalWeight, ' кг');
  console.log(`  ${'активность'.padEnd(22)} ${response.profile.activityLevel}`);
  console.log(
    `  ${'дефицит'.padEnd(22)} ${response.profile.deficitValue} ${response.profile.deficitMode}`,
  );
  console.log(`  ${'вес для BMR'.padEnd(22)} ${response.weight.kg ?? '—'} (${response.weight.source})`);

  console.log('\nРасчёт по формулам:');
  line('возраст', response.computed.ageYears, ' лет');
  line('BMR', response.computed.bmr, ' ккал');
  line('TDEE', response.computed.tdee, ' ккал');
  line('калории', response.computed.kcal, ' ккал');
  line('белок', response.computed.protein, ' г');
  line('жиры', response.computed.fat, ' г');
  line('углеводы', response.computed.carb, ' г');
  line('сладкое', response.computed.sweets, ' ккал');

  console.log('\nПрименяется (с учётом ручных переопределений):');
  line('калории', response.effective.kcal, ' ккал');
  line('белок', response.effective.protein, ' г');
  line('жиры', response.effective.fat, ' г');
  line('углеводы', response.effective.carb, ' г');
  line('сладкое', response.effective.sweets, ' ккал');

  if (response.missing.length > 0) {
    console.log(`\nНе заполнено: ${response.missing.join(', ')}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
