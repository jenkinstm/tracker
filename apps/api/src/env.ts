import { z } from 'zod';

/** 32 байта — размер ключа для secretbox в @fastify/secure-session. */
const SESSION_KEY_BYTES = 32;

function isBase64Key(value: string): boolean {
  const buffer = Buffer.from(value, 'base64');
  // Buffer.from молча выбрасывает мусорные символы, поэтому проверяем обратной сборкой.
  return buffer.length === SESSION_KEY_BYTES && buffer.toString('base64') === value;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  AUTH_PASSWORD_HASH: z
    .string()
    .regex(/^\$argon2id\$/, 'ожидается argon2id-хеш, сгенерируй его через `pnpm hash-password`'),
  SESSION_SECRET: z.string().refine(isBase64Key, 'ожидаются 32 случайных байта в base64'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  TZ: z.string().default('Europe/Amsterdam'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Печатаем только имена переменных и причину — значения в лог не попадают.
  const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
  console.error(`Переменные окружения заполнены неверно:\n${problems.join('\n')}`);
  process.exit(1);
}

const raw = parsed.data;

export const isProduction = raw.NODE_ENV === 'production';

export const env = {
  ...raw,
  TRUST_PROXY: raw.TRUST_PROXY === 'true',
  // В деве работаем по http, поэтому Secure по умолчанию только на проде.
  COOKIE_SECURE: raw.COOKIE_SECURE ? raw.COOKIE_SECURE === 'true' : isProduction,
} as const;
