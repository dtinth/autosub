import KeyvSqlite from "@keyv/sqlite";

export const store = new KeyvSqlite("sqlite://state.sqlite");
