import { useCallback, useEffect, useState } from "react";
import {
  connectWallet, eagerAccount, onWalletEvents, currentChainId, hasWallet,
} from "../lib/genlayer.js";
import { CHAIN_ID } from "../lib/format.js";

const CHAIN_ID_HEX = "0x" + CHAIN_ID.toString(16);

export function useWallet() {
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  // Silent reconnect + reflect current chain on load.
  useEffect(() => {
    let alive = true;
    (async () => {
      const a = await eagerAccount();
      if (alive && a) setAddress(a);
      const c = await currentChainId();
      if (alive) setChainId(c);
    })();
    return () => { alive = false; };
  }, []);

  // React to wallet account/chain changes.
  useEffect(() => {
    return onWalletEvents({
      onAccounts: (a) => { setAddress(a); if (!a) setError(null); },
      onChain: (c) => setChainId(c),
    });
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const a = await connectWallet();
      setAddress(a);
      setChainId(await currentChainId());
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  // MetaMask has no programmatic disconnect; clear app-side session state.
  const disconnect = useCallback(() => {
    setAddress(null);
    setError(null);
  }, []);

  const wrongChain = !!address && chainId != null && chainId !== CHAIN_ID_HEX;

  return { address, chainId, wrongChain, connecting, error, connect, disconnect, available: hasWallet() };
}
