import { createSqlStorage } from "@thai/sql-storage";
import Database from "bun:sqlite";

const db = new Database("project.db");
db.exec("PRAGMA busy_timeout = 3000");
export const projectStorage = createSqlStorage(db);

export function ref<T>(key: string) {
  return {
    get() {
      const data = projectStorage.getItem(key);
      if (!data) return undefined;
      return JSON.parse(data) as T;
    },
    set(value: T) {
      projectStorage.setItem(key, JSON.stringify(value));
    },
    exists() {
      return !!projectStorage.getItem(key);
    },
  };
}
