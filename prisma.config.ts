import { defineConfig } from "prisma/config";
import fs from "fs";
import path from "path";

// Load local .env file in development / local migration runs
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const index = trimmed.indexOf("=");
      const key = trimmed.substring(0, index).trim();
      let val = trimmed.substring(index + 1).trim();
      // Remove surrounding quotes if any
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
      }
      if (key) {
        process.env[key] = val;
      }
    }
  });
}

console.log("[PrismaConfig Debug] Loaded process.env.DATABASE_URL:", process.env.DATABASE_URL);

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
