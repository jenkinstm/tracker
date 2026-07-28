import type { SessionInfo } from '@tracker/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, api } from './api.js';

export const sessionQueryKey = ['session'] as const;

export function useSession() {
  return useQuery<SessionInfo | null>({
    queryKey: sessionQueryKey,
    queryFn: async () => {
      try {
        return await api.get<SessionInfo>('/api/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api.post<SessionInfo>('/api/auth/login', { password }),
    onSuccess: (session) => {
      queryClient.setQueryData(sessionQueryKey, session);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSuccess: () => {
      queryClient.setQueryData(sessionQueryKey, null);
    },
  });
}
