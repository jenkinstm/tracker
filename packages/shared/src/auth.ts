import { z } from 'zod';

/** Вход по паролю (FR-1.0). Тип для фронта выводится отсюда, руками не дублируется. */
export const loginSchema = z.object({
  password: z.string().min(1).max(512),
});

export type LoginInput = z.infer<typeof loginSchema>;

export type SessionInfo = {
  userId: string;
};
