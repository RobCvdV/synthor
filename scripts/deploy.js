import { ftp } from "basic-ftp";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(import.meta.dirname, "..", ".env.local");
if (!existsSync(envPath)) {
  console.error("❌ .env.local not found. Copy .env.local.example and fill in the password.");
  process.exit(1);
}

const { default: dotenv } = await import("dotenv");
dotenv.config({ path: envPath });

const host = process.env.FTP_HOST || "ftp.akiar.nl";
const user = process.env.FTP_USER || "synthor@akiar.nl";
const password = process.env.FTP_PASSWORD;
const localPath = resolve(import.meta.dirname, "..", "dist");

function validateConfig() {
  if (!password) {
    console.error("❌ FTP_PASSWORD not set in .env.local");
    process.exit(1);
  }
  if (!existsSync(localPath)) {
    console.error("❌ dist/ folder not found. Run `npm run build` first.");
    process.exit(1);
  }
}

async function deploy() {
  console.log("🚀 Deploying to synthor.akiar.nl...\n");

  validateConfig();

  const client = new ftp.Client();
  client.ftp.verbose = true;

  try {
    console.log(`📡 Connecting to ${host}...`);
    await client.access({ host, user, password, secure: true, secureOptions: { rejectUnauthorized: false } });
    console.log("✅ Connected!\n");

    console.log("📤 Uploading dist/ ...\n");
    await client.uploadFromDir(localPath);
    // Clean up remote files that no longer exist locally
    await client.removeExclusive(localPath);

    console.log("\n✅ Deployed to https://synthor.akiar.nl");
  } catch (err) {
    console.error("\n❌ Deployment failed:", err.message);
    process.exit(1);
  } finally {
    client.close();
    console.log("🔌 Connection closed.");
  }
}

deploy();
