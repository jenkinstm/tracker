import type { WeightSeriesResponse, WeightUpsert } from '@tracker/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api.js';
import { profileQueryKey } from './profile.js';

export const weightStatsQueryKey = ['weight', 'stats'] as const;

export function useWeightStats() {
  return useQuery<WeightSeriesResponse>({
    queryKey: weightStatsQueryKey,
    queryFn: () => api.get<WeightSeriesResponse>('/api/stats/trend'),
  });
}

function useWeightMutation<TInput>(mutationFn: (input: TInput) => Promise<WeightSeriesResponse>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (response) => {
      queryClient.setQueryData(weightStatsQueryKey, response);
      // BMR считается от последнего взвешивания, так что норма калорий
      // после записи веса меняется — профиль в кэше устарел.
      void queryClient.invalidateQueries({ queryKey: profileQueryKey });
      void queryClient.invalidateQueries({ queryKey: ['diary'] });
    },
  });
}

export function useSaveWeight() {
  return useWeightMutation((input: WeightUpsert) =>
    api.post<WeightSeriesResponse>('/api/weights', input),
  );
}

export function useDeleteWeight() {
  return useWeightMutation((date: string) =>
    api.delete<WeightSeriesResponse>(`/api/weights/${date}`),
  );
}
