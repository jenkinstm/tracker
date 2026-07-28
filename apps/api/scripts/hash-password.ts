/**
 * Генерация argon2id-хеша пароля для AUTH_PASSWORD_HASH.
 *
 * По умолчанию пишет результат прямо в `.env` в корне репозитория, чтобы хеш
 * не оседал в истории терминала. `--print` печатает его в stdout вместо записи.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { hash } from '@node-rs/argon2';

// Параметры по рекомендации OWASP: 19 МиБ, 2 прохода, 1 поток.
// Алгоритм не указываем: Algorithm — ambient const enum, его не импортировать
// при verbatimModuleSyntax, а argon2id и так стоит в @node-rs/argon2 по умолчанию.
// Результат ниже проверяется на префикс, так что молчаливой подмены не будет.
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));

let muted = false;

const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk as Buffer, encoding);
    callback();
  },
});

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output, terminal: true });
    rl.question(question, (answer) => {
      muted = false;
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

/** Пароль из пайпа — для скриптов и CI. Первая строка stdin, без подтверждения. */
function readFromPipe(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
    });
    process.stdin.on('end', () => resolve(buffer.split('\n')[0] ?? ''));
    process.stdin.on('error', reject);
  });
}

/**
 * Значение всегда в одинарных кавычках. Docker Compose интерполирует .env,
 * и argon2id-хеш ($argon2id$v=19$m=...) без кавычек приезжает в контейнер
 * выпотрошенным: $argon2id, $v, $m он считает за неизвестные переменные.
 */
function upsertEnvVar(content: string, key: string, value: string): string {
  if (value.includes("'")) {
    throw new Error(`Значение ${key} содержит одинарную кавычку, экранирование в .env не предусмотрено`);
  }
  const line = `${key}='${value}'`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(content)) return content.replace(pattern, line);
  return content.endsWith('\n') || content === '' ? `${content}${line}\n` : `${content}\n${line}\n`;
}

function hasValue(content: string, key: string): boolean {
  const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (match?.[1] === undefined) return false;
  return match[1].trim().replace(/^'|'$/g, '') !== '';
}

const interactive = process.stdin.isTTY === true;

const password = interactive ? await askHidden('Пароль: ') : await readFromPipe();
if (password.length === 0) {
  console.error('Пустой пароль не годится.');
  process.exit(1);
}

if (interactive) {
  const confirmation = await askHidden('Ещё раз: ');
  if (password !== confirmation) {
    console.error('Пароли не совпали.');
    process.exit(1);
  }
}

const passwordHash = await hash(password, ARGON2_OPTIONS);

if (!passwordHash.startsWith('$argon2id$')) {
  console.error(`Ожидался argon2id, получен другой алгоритм: ${passwordHash.split('$')[1]}`);
  process.exit(1);
}

if (process.argv.includes('--print')) {
  console.log(passwordHash);
  process.exit(0);
}

const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
let updated = upsertEnvVar(existing, 'AUTH_PASSWORD_HASH', passwordHash);

const notes = ['AUTH_PASSWORD_HASH записан в .env'];

if (!hasValue(updated, 'SESSION_SECRET')) {
  updated = upsertEnvVar(updated, 'SESSION_SECRET', randomBytes(32).toString('base64'));
  notes.push('SESSION_SECRET сгенерирован и записан туда же');
}

writeFileSync(ENV_PATH, updated, { mode: 0o600 });

console.log(notes.join('\n'));
console.log('Перезапусти контейнер api, чтобы он подхватил новое значение.');
