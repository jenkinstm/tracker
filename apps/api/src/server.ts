import { buildApp } from './app.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { getSingleUser } from './lib/user.js';

const app = await buildApp();

await getSingleUser();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => prisma.$disconnect())
      .then(() => process.exit(0));
  });
}

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
