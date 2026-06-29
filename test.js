const { createClient } = require('@libsql/client');
require('dotenv').config({ path: __dirname + '/.env' });

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function resetDb() {
  console.log('Dropping tables...');
  try {
    const tables = ['notifications', 'key_types', 'payments', 'licenses', 'key_pool', 'product_days', 'products', 'users'];
    for (const table of tables) {
      try {
        await db.execute(`DROP TABLE IF EXISTS ${table}`);
        console.log(`Dropped ${table}`);
      } catch (e) {
        console.log(`Error dropping ${table}: ${e.message}`);
      }
    }
    console.log('Database reset complete. Please restart the server to recreate tables.');
  } catch (error) {
    console.error('Reset error:', error);
  }
}

resetDb();
