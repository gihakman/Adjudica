import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { CONTRACT_ADDRESS, CHAIN_ID } from "./format.js";

// ---- read client (no wallet; talks straight to the Bradbury RPC) ----
let _readClient = null;
export function readClient() {
  if (!_readClient) _readClient = createClient({ chain: testnetBradbury });
  return _readClient;
}

export function read(functionName, args = []) {
  return readClient().readContract({ address: CONTRACT_ADDRESS, functionName, args });
}

// ---- wallet (EIP-1193 injected provider; NO MetaMask Snaps) ----
export function getProvider() {
  return typeof window !== "undefined" ? window.ethereum : undefined;
}
export function hasWallet() {
  return !!getProvider();
}

const CHAIN_ID_HEX = "0x" + CHAIN_ID.toString(16);
const CHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: testnetBradbury.name,
  nativeCurrency: testnetBradbury.nativeCurrency,
  rpcUrls: testnetBradbury.rpcUrls.default.http,
  blockExplorerUrls: [testnetBradbury.blockExplorers.default.url],
};

export async function currentChainId() {
  const p = getProvider();
  if (!p) return null;
  return p.request({ method: "eth_chainId" });
}

// Add + switch to Bradbury using standard wallet RPC methods (no Snaps).
export async function ensureBradbury() {
  const p = getProvider();
  if (!p) throw new Error("No EVM wallet detected. Install MetaMask (or any EIP-1193 wallet) to write.");
  const chainId = await p.request({ method: "eth_chainId" });
  if (chainId === CHAIN_ID_HEX) return;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
  } catch (err) {
    // 4902 = chain not added yet; add it, then switch.
    if (err && (err.code === 4902 || err.code === -32603 || /Unrecognized chain/i.test(String(err.message)))) {
      await p.request({ method: "wallet_addEthereumChain", params: [CHAIN_PARAMS] });
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
    } else {
      throw err;
    }
  }
}

export async function connectWallet() {
  const p = getProvider();
  if (!p) throw new Error("No EVM wallet detected. Install MetaMask (or any EIP-1193 wallet).");
  const accounts = await p.request({ method: "eth_requestAccounts" });
  const address = accounts?.[0];
  if (!address) throw new Error("No account authorized.");
  await ensureBradbury();
  return address;
}

// Best-effort silent reconnect (no prompt) on page load.
export async function eagerAccount() {
  const p = getProvider();
  if (!p) return null;
  try {
    const accounts = await p.request({ method: "eth_accounts" });
    return accounts?.[0] ?? null;
  } catch {
    return null;
  }
}

export function onWalletEvents({ onAccounts, onChain }) {
  const p = getProvider();
  if (!p?.on) return () => {};
  const acc = (a) => onAccounts?.(Array.isArray(a) ? a[0] ?? null : null);
  const chn = (c) => onChain?.(c);
  p.on("accountsChanged", acc);
  p.on("chainChanged", chn);
  return () => {
    p.removeListener?.("accountsChanged", acc);
    p.removeListener?.("chainChanged", chn);
  };
}

// ---- write client (wallet-signed) ----
export function writeClient(address) {
  return createClient({ chain: testnetBradbury, account: address, provider: getProvider() });
}

export async function write(address, functionName, args = [], value = 0n) {
  await ensureBradbury();
  const client = writeClient(address);
  return client.writeContract({ address: CONTRACT_ADDRESS, functionName, args, value });
}

// ---- transaction status polling (for live UI) ----
export async function pollTransaction(hash, onPhase, { intervalMs = 4000, maxMs = 240000 } = {}) {
  const client = readClient();
  const start = Date.now();
  let last = null;
  while (Date.now() - start < maxMs) {
    let tx;
    try {
      tx = await client.getTransaction({ hash });
    } catch {
      // transient RPC / not-indexed-yet — keep polling
    }
    const status = tx?.statusName || tx?.status;
    if (status && status !== last) {
      last = status;
      onPhase?.(String(status));
    }
    if (status === "FINALIZED" || status === "ACCEPTED" || status === "UNDETERMINED" || status === "CANCELED") {
      // ACCEPTED is enough for UX; keep the terminal-ish status.
      if (status !== "ACCEPTED") return String(status);
      // give a brief chance to observe FINALIZED, but don't block UX long
      if (Date.now() - start > 8000) return String(status);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last || "PENDING";
}
