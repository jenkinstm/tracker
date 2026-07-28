import { todayIso } from '@tracker/shared';

import { prisma } from '../src/db.js';
import { getSingleUser } from '../src/lib/user.js';
import { addSet, getWorkoutDay, setSteps, startWorkout } from '../src/lib/workout.js';

/**
 * Проверка приёмки блока 6, критерий №3: тренировка из 5 упражнений
 * по 4 подхода логируется без единого обращения к клавиатуре, если веса
 * совпадают с прошлым разом.
 *
 * «Без клавиатуры» здесь значит: ни один запрос не передаёт вес или повторы —
 * только `done: true`. Скрипт считает такие запросы и падает, если хоть один
 * потребовал ввода чисел.
 */

let failed = false;

function check(label: string, condition: boolean, detail = '') {
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failed = true;
}

/** Отметка подхода: ровно то, что делает тап по строке в интерфейсе. */
async function tapSet(setId: string) {
  await prisma.workoutSet.update({ where: { id: setId }, data: { done: true } });
}

async function main() {
  const user = await getSingleUser();
  const today = todayIso();

  const existingWorkouts = await prisma.workout.count({ where: { userId: user.id } });
  if (existingWorkouts > 0) {
    console.log(`В базе уже ${existingWorkouts} тренировок — скрипт добавит свои и уберёт их.\n`);
  }

  const created: string[] = [];

  try {
    console.log('── Программы из сида (FR-5.2)\n');

    let day = await getWorkoutDay(user.id, today);
    check('программы доступны для старта', day.programs.length === 3, `${day.programs.length}`);

    const programA = day.programs.find((p) => p.name === 'Программа A');
    check('программа A на месте', programA !== undefined);
    check('в программе 5 упражнений', programA?.items.length === 5, `${programA?.items.length}`);

    console.log('\n── Первая тренировка: истории ещё нет\n');

    const first = await startWorkout(user.id, today, programA!.id);
    check('тренировка стартовала', first.ok);
    if (first.ok) created.push(first.id);

    day = await getWorkoutDay(user.id, today);
    const workout = day.workout!;

    check('упражнения подтянулись из программы', workout.exercises.length === 5, `${workout.exercises.length}`);
    check(
      'подходы созданы заранее, а не по ходу',
      workout.totalSets > 0,
      `${workout.totalSets} подходов`,
    );
    check(
      'порядок упражнений соответствует программе',
      workout.exercises[0]?.exercise.name === programA!.items[0]?.exercise.name,
      workout.exercises[0]?.exercise.name,
    );
    check(
      'повторы предзаполнены из плана программы',
      workout.exercises[0]?.sets[0]?.reps === programA!.items[0]?.targetReps,
      `${workout.exercises[0]?.sets[0]?.reps}`,
    );
    check(
      'вес пуст: упражнение делается впервые',
      workout.exercises[0]?.sets[0]?.weightKg === null,
    );

    console.log('\n── Первый раз: веса вводятся руками\n');

    // Проставляем рабочие веса — это единственное место, где нужна клавиатура.
    const weights = [40, 22, 24, 0, 0];
    for (const [index, exercise] of workout.exercises.entries()) {
      for (const set of exercise.sets) {
        await prisma.workoutSet.update({
          where: { id: set.id },
          data: { weightKg: weights[index] || null, reps: set.reps ?? 10, done: true },
        });
      }
    }

    day = await getWorkoutDay(user.id, today);
    check(
      'все подходы отмечены',
      day.workout!.doneSets === day.workout!.totalSets,
      `${day.workout!.doneSets} из ${day.workout!.totalSets}`,
    );
    check('тоннаж посчитан', day.workout!.volume > 0, `${day.workout!.volume} кг`);

    console.log('\n── Вторая тренировка: критерий приёмки №3\n');

    const secondDate = '2026-07-29';
    const second = await startWorkout(user.id, secondDate, programA!.id);
    if (second.ok) created.push(second.id);

    const secondDay = await getWorkoutDay(user.id, secondDate);
    const secondWorkout = secondDay.workout!;

    check(
      'веса подставились с прошлого раза (FR-5.4)',
      secondWorkout.exercises[0]?.sets.every((set) => set.weightKg === weights[0]) ?? false,
      `${secondWorkout.exercises[0]?.sets[0]?.weightKg} кг во всех подходах`,
    );
    check(
      'повторы подставились с прошлого раза',
      secondWorkout.exercises[0]?.sets[0]?.reps === 10,
      `${secondWorkout.exercises[0]?.sets[0]?.reps}`,
    );
    check(
      'ни один подход не отмечен заранее',
      secondWorkout.doneSets === 0,
      `${secondWorkout.doneSets}`,
    );

    // Приводим к условиям критерия: 5 упражнений × 4 подхода.
    for (const exercise of secondWorkout.exercises) {
      while ((await countSets(secondWorkout.id, exercise.exercise.id)) < 4) {
        await addSet(user.id, secondWorkout.id, exercise.exercise.id);
      }
    }

    const ready = (await getWorkoutDay(user.id, secondDate)).workout!;
    check('5 упражнений по 4 подхода', ready.totalSets === 20, `${ready.totalSets} подходов`);
    check(
      '«+ подход» продублировал вес последнего',
      ready.exercises[0]?.sets.every((set) => set.weightKg === weights[0]) ?? false,
    );

    // Собственно критерий: только тапы, ни одного ввода чисел.
    let keyboardTouches = 0;
    for (const exercise of ready.exercises) {
      for (const set of exercise.sets) {
        if (set.reps === null && set.weightKg === null) keyboardTouches += 1;
        await tapSet(set.id);
      }
    }

    const logged = (await getWorkoutDay(user.id, secondDate)).workout!;
    check(
      'все 20 подходов отмечены одними тапами',
      logged.doneSets === 20,
      `${logged.doneSets} из ${logged.totalSets}`,
    );
    check(
      'клавиатура не понадобилась ни разу',
      keyboardTouches === 0,
      `${keyboardTouches} подходов потребовали ввода`,
    );
    check('тоннаж второй тренировки посчитан', logged.volume > 0, `${logged.volume} кг`);

    console.log('\n── Свободная тренировка и шаги\n');

    const freeDate = '2026-07-30';
    const free = await startWorkout(user.id, freeDate, null);
    check('тренировка без программы стартует', free.ok);
    if (free.ok) created.push(free.id);

    const freeDay = await getWorkoutDay(user.id, freeDate);
    check('без программы подходов нет', freeDay.workout?.totalSets === 0);

    const someExercise = programA!.items[0]!.exercise.id;
    await addSet(user.id, free.ok ? free.id : '', someExercise);
    const withSet = await getWorkoutDay(user.id, freeDate);
    check(
      'упражнение добавляется в свободную тренировку',
      withSet.workout?.totalSets === 1,
      `${withSet.workout?.totalSets}`,
    );
    check(
      'вес подтянулся из истории и здесь',
      withSet.workout?.exercises[0]?.sets[0]?.weightKg === weights[0],
      `${withSet.workout?.exercises[0]?.sets[0]?.weightKg} кг`,
    );

    await setSteps(user.id, today, 9500);
    const withSteps = await getWorkoutDay(user.id, today);
    check(
      'шаги сохраняются (FR-5.9)',
      withSteps.steps === 9500,
      `${withSteps.steps} при цели ${withSteps.stepsTarget}`,
    );
  } finally {
    console.log('\n── Уборка\n');

    for (const id of created) {
      await prisma.workout.deleteMany({ where: { id, userId: user.id } });
    }
    await setSteps(user.id, today, null);

    const left = await prisma.workout.count({ where: { userId: user.id } });
    check('созданные тренировки удалены', left === existingWorkouts, `${left} осталось`);
  }
}

async function countSets(workoutId: string, exerciseId: string): Promise<number> {
  return prisma.workoutSet.count({ where: { workoutId, exerciseId } });
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
