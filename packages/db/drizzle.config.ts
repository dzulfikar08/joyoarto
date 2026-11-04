import { defineConfig } from "drizzle-kit";

// Migrations are generated here and applied with wrangler (apps/server: db:migrate:local / db:migrate:remote).
export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "sqlite",
});
