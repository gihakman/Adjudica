import deployment from "../deployment.json";

export const EXPLORER = deployment.explorer?.replace(/\/$/, "") || "https://explorer-bradbury.genlayer.com";
export const CONTRACT_ADDRESS = deployment.contractAddress;
export const CHAIN_ID = deployment.chainId || 4221;

export function shortAddr(a) {
  if (!a) return "n/a";
  const s = String(a);
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

export function attoToGen(atto) {
  try {
    const v = BigInt(atto ?? 0);
    if (v === 0n) return "0";
    const whole = v / 10n ** 18n;
    const frac = (v % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : `${whole}`;
  } catch {
    return "0";
  }
}

export function genToAtto(gen) {
  const [whole, frac = ""] = String(gen ?? "0").trim().split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole || "0") * 10n ** 18n + BigInt(fracPadded || "0");
}

export function txUrl(hash) {
  return `${EXPLORER}/tx/${hash}`;
}
export function addrUrl(addr) {
  return `${EXPLORER}/address/${addr}`;
}

// Present a JSON-safe object (BigInt -> string) for console output.
export function pretty(value) {
  return JSON.stringify(
    value,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );
}

export const STATUS_ORDER = ["PENDING", "PROPOSING", "COMMITTING", "REVEALING", "ACCEPTED", "FINALIZED"];
