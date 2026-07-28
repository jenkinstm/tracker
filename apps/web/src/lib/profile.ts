import type { ProfileResponse, ProfileUpdate } from '@tracker/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api.js';

export const profileQueryKey = ['profile'] as const;

export function useProfile() {
  return useQuery<ProfileResponse>({
    queryKey: profileQueryKey,
    queryFn: () => api.get<ProfileResponse>('/api/profile'),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: ProfileUpdate) => api.put<ProfileResponse>('/api/profile', update),
    // Ответ уже содержит пересчитанные цели — отдельный запрос за ними не нужен.
    onSuccess: (response) => {
      queryClient.setQueryData(profileQueryKey, response);
    },
  });
}
