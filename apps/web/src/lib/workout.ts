import type {
  ExerciseCreate,
  ExerciseInfo,
  ProgramCreate,
  ProgramInfo,
  ProgramUpdate,
  SetUpdate,
  WorkoutDay,
} from '@tracker/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api.js';

export const workoutQueryKey = (date: string) => ['workout', date] as const;
export const exercisesQueryKey = ['exercises'] as const;
export const programsQueryKey = ['programs'] as const;

export function useWorkoutDay(date: string) {
  return useQuery<WorkoutDay>({
    queryKey: workoutQueryKey(date),
    queryFn: () => api.get<WorkoutDay>(`/api/workouts/${date}`),
  });
}

/** Все мутации тренировки возвращают день целиком — пересчитывать нечего. */
function useWorkoutMutation<TInput>(mutationFn: (input: TInput) => Promise<WorkoutDay>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (day) => {
      queryClient.setQueryData(workoutQueryKey(day.date), day);
    },
  });
}

export function useStartWorkout(date: string) {
  return useWorkoutMutation((programId: string | null) =>
    api.post<WorkoutDay>('/api/workouts', { date, programId }),
  );
}

export function useDeleteWorkout() {
  return useWorkoutMutation((id: string) => api.delete<WorkoutDay>(`/api/workouts/${id}`));
}

export function useUpdateSet() {
  return useWorkoutMutation(({ id, ...update }: SetUpdate & { id: string }) =>
    api.patch<WorkoutDay>(`/api/sets/${id}`, update),
  );
}

export function useDeleteSet() {
  return useWorkoutMutation((id: string) => api.delete<WorkoutDay>(`/api/sets/${id}`));
}

export function useAddSet(workoutId: string) {
  return useWorkoutMutation((exerciseId: string) =>
    api.post<WorkoutDay>(`/api/workouts/${workoutId}/sets`, { exerciseId }),
  );
}

export function useSetSteps(date: string) {
  return useWorkoutMutation((steps: number | null) =>
    api.put<WorkoutDay>(`/api/daily/${date}/steps`, { steps }),
  );
}

export function useExercises() {
  return useQuery<ExerciseInfo[]>({
    queryKey: exercisesQueryKey,
    queryFn: () => api.get<ExerciseInfo[]>('/api/exercises'),
  });
}

export function useCreateExercise() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ExerciseCreate) => api.post<ExerciseInfo>('/api/exercises', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: exercisesQueryKey });
    },
  });
}

export function usePrograms() {
  return useQuery<ProgramInfo[]>({
    queryKey: programsQueryKey,
    queryFn: () => api.get<ProgramInfo[]>('/api/programs'),
  });
}

function useProgramMutation<TInput>(mutationFn: (input: TInput) => Promise<unknown>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: programsQueryKey });
      // Экран тренировки показывает список программ для старта.
      void queryClient.invalidateQueries({ queryKey: ['workout'] });
    },
  });
}

export function useCreateProgram() {
  return useProgramMutation((input: ProgramCreate) => api.post<ProgramInfo>('/api/programs', input));
}

export function useUpdateProgram() {
  return useProgramMutation(({ id, ...update }: ProgramUpdate & { id: string }) =>
    api.patch<ProgramInfo>(`/api/programs/${id}`, update),
  );
}

export function useDeleteProgram() {
  return useProgramMutation((id: string) => api.delete<void>(`/api/programs/${id}`));
}
