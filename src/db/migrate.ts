import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb, dbFile } from "./index";

const db = createDb(dbFile());
migrate(db, { migrationsFolder: "./drizzle" });
console.log(`[db] migrations applied to ${dbFile()}`);
