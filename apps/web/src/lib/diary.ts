import type {
  DiaryCreate,
  DiaryDay,
  DiaryUpdate,
  FoodCreate,
  FoodInfo,
  RecentResponse,
} from '@tracker/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api.js';

export const diaryQueryKey = (date: string) => ['diary', date] as const;
export const recentQueryKey = ['diary', 'recent'] as const;
export const foodSearchQueryKey = (query: string) => ['foods', query] as const;

export function useDiaryDay(date: string) {
  return useQuery<DiaryDay>({
    queryKey: diaryQueryKey(date),
    queryFn: () => api.get<DiaryDay>(`/api/diary/${date}`),
  });
}

/**
 * Все мутации дня возвращают день целиком — итоги и остаток пересчитаны
 * на сервере, второй запрос за ними не нужен. «Недавние» после записи
 * устаревают, поэтому их помечаем к перезагрузке.
 */
function useDayMutation<TInput>(mutationFn: (input: TInput) => Promise<DiaryDay>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (day) => {
      queryClient.setQueryData(diaryQueryKey(day.date), day);
      void queryClient.invalidateQueries({ queryKey: recentQueryKey });
    },
  });
}

export function useAddEntry() {
  return useDayMutation((input: DiaryCreate) => api.post<DiaryDay>('/api/diary', input));
}

export function useUpdateEntry() {
  return useDayMutation(({ id, ...update }: DiaryUpdate & { id: string }) =>
    api.patch<DiaryDay>(`/api/diary/${id}`, update),
  );
}

export function useDeleteEntry() {
  return useDayMutation((id: string) => api.delete<DiaryDay>(`/api/diary/${id}`));
}

export function useSetWater(date: string) {
  return useDayMutation((glasses: number) =>
    api.put<DiaryDay>(`/api/daily/${date}/water`, { glasses }),
  );
}

export function useRecentFoods() {
  return useQuery<RecentResponse>({
    queryKey: recentQueryKey,
    queryFn: () => api.get<RecentResponse>('/api/diary/recent'),
  });
}

export function useFoodSearch(query: string) {
  const trimmed = query.trim();

  return useQuery<FoodInfo[]>({
    queryKey: foodSearchQueryKey(trimmed),
    queryFn: () => api.get<FoodInfo[]>(`/api/foods?q=${encodeURIComponent(trimmed)}`),
    enabled: trimmed.length > 0,
    // Результат по одному и тому же запросу не меняется на глазах —
    // держим его, чтобы возврат к запросу не мигал загрузкой (NFR-2).
    staleTime: 60 * 1000,
  });
}

export function useCreateFood() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: FoodCreate) => api.post<FoodInfo>('/api/foods', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['foods'] });
    },
  });
}
