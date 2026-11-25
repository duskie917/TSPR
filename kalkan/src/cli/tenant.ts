/**
 * Create an API key for a B2B partner (bank, MFI, telecom operator):
 *   npm run tenant:create -- "Банк Пример"
 * The key is shown once; only its hash is stored.
 */
import { config } from "../config.ts";
import { Store } from "../storage/db.ts";

const name = process.argv.slice(2).join(" ").trim();
if (!name) {
  console.error('Usage: npm run tenant:create -- "Название партнера"');
  process.exit(1);
}
const store = new Store(config.dbPath);
const { id, apiKey } = store.createTenant(name);
console.log(`Партнер #${id} «${name}» создан.\nAPI-ключ (сохраните, он показывается один раз):\n${apiKey}`);
