import { randomBytes } from 'node:crypto';
import { openDb } from './src/db.js';
import { createApp } from './src/app.js';

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? new URL('./data/live_scoring.db', import.meta.url).pathname;

let adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
  adminPassword = randomBytes(6).toString('base64url');
  console.warn(`ADMIN_PASSWORD is not set. Using a temporary password for this run: ${adminPassword}`);
}

const store = openDb(dbPath);
const server = createApp({ store, adminPassword, secureCookies: process.env.SECURE_COOKIES === '1' });

server.listen(port, () => {
  console.log(`Live scoring running on http://localhost:${port}`);
  console.log(`  Public standings: http://localhost:${port}/`);
  console.log(`  Admin:            http://localhost:${port}/admin`);
  console.log(`  Database:         ${dbPath}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.closeStreams();
    server.close(() => process.exit(0));
  });
}
