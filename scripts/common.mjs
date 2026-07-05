// Shared helpers for Adjudica deploy/seed scripts (GenLayer Bradbury).
// Reads ACCOUNT_PRIVATE_KEY only from process.env; never logs or persists it.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
export const CONTRACT_PATH = path.join(ROOT, "contracts", "adjudica.py");
export const DEPLOYMENT_PATH = path.join(__dirname, "deployment.json");
export const FRONTEND_DEPLOYMENT = path.join(ROOT, "frontend", "src", "deployment.json");
export const EXPLORER = "https://explorer-bradbury.genlayer.com";

export { TransactionStatus };

export function getPrivateKey() {
  let pk = process.env.ACCOUNT_PRIVATE_KEY;
  if (!pk || !pk.trim()) {
    throw new Error(
      "ACCOUNT_PRIVATE_KEY is missing from the repo-root .env. It is required to sign transactions."
    );
  }
  pk = pk.trim();
  if (!pk.startsWith("0x")) pk = "0x" + pk;
  return pk;
}

export function makeClient() {
  const account = createAccount(getPrivateKey());
  const client = createClient({ chain: testnetBradbury, account });
  return { client, account };
}

export function feeConfig() {
  const feeBps = Number.parseInt(process.env.FEE_BPS ?? "100", 10);
  const feeRecipient = (process.env.FEE_RECIPIENT ?? "").trim();
  return { feeBps: Number.isFinite(feeBps) ? feeBps : 100, feeRecipient };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry with exponential backoff — handles gen_call rate limits and transient RPC errors.
export async function retry(fn, { tries = 6, base = 1500, label = "op" } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message ?? err);
      const rateLimited = /429|rate.?limit|-32429|-32028|too many/i.test(msg);
      const wait = base * Math.pow(2, i) + Math.floor(Math.random() * 500);
      console.warn(`  [retry] ${label} failed (attempt ${i + 1}/${tries})${rateLimited ? " [rate-limited]" : ""}: ${msg}`);
      if (i < tries - 1) await sleep(wait);
    }
  }
  throw lastErr;
}

export function genToAtto(gen) {
  // gen may be a decimal string/number; convert to atto (10^18) precisely.
  const [whole, frac = ""] = String(gen).split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole || "0") * 10n ** 18n + BigInt(fracPadded || "0");
}

export function attoToGen(atto) {
  const v = BigInt(atto);
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export async function getBalanceAtto(client, address) {
  const hex = await client.request({ method: "eth_getBalance", params: [address, "latest"] });
  return BigInt(hex);
}

export function saveDeployment(data) {
  const json = JSON.stringify(data, null, 2) + "\n";
  fs.writeFileSync(DEPLOYMENT_PATH, json);
  fs.mkdirSync(path.dirname(FRONTEND_DEPLOYMENT), { recursive: true });
  fs.writeFileSync(FRONTEND_DEPLOYMENT, json);
}

export function loadDeployment() {
  if (!fs.existsSync(DEPLOYMENT_PATH)) {
    throw new Error("deployment.json not found. Run `npm run deploy` first.");
  }
  return JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
}

export function readContractSource() {
  return new Uint8Array(fs.readFileSync(CONTRACT_PATH));
}

// Deterministic demo agent addresses (valid 20-byte lowercase hex). These
// represent distinct autonomous agents / operators participating in workflows.
const mkAddr = (prefix) => "0x" + prefix.padEnd(40, "0").slice(0, 40);
export const AGENTS = {
  scholar: mkAddr("a11ce1"),      // research / scholar agent
  synthesizer: mkAddr("b0b2"),    // synthesis agent
  pipeline: mkAddr("c0de3"),      // data-pipeline agent
  moderator: mkAddr("d00d4"),     // moderation agent
  ranker: mkAddr("e0e5"),         // ranking agent
};
