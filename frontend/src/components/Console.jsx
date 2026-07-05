import { useMemo, useState } from "react";
import { READ_METHODS, WRITE_METHODS } from "../lib/abi.js";
import { read, write, pollTransaction } from "../lib/genlayer.js";
import { pretty, genToAtto, shortAddr, CONTRACT_ADDRESS, addrUrl } from "../lib/format.js";
import { TxStatus } from "./TxStatus.jsx";

function Params({ method, values, setValues }) {
  return (
    <>
      {method.params.map((p) => (
        <div className="field" key={p.name}>
          <label>{p.name} <span className="muted">· {p.kind}</span></label>
          {p.type === "textarea" ? (
            <textarea
              placeholder={p.placeholder}
              value={values[p.name] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
            />
          ) : (
            <input
              type={p.type === "number" ? "number" : "text"}
              placeholder={p.placeholder}
              value={values[p.name] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
            />
          )}
        </div>
      ))}
    </>
  );
}

function coerce(kind, raw) {
  if (kind === "int") return Number.parseInt(raw, 10);
  if (kind === "atto") return genToAtto(raw);
  return raw ?? "";
}

function ReadPanel() {
  const [idx, setIdx] = useState(0);
  const method = READ_METHODS[idx];
  const [values, setValues] = useState({});
  const [out, setOut] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function call() {
    setErr(null); setOut(null); setBusy(true);
    try {
      const args = method.params.map((p) => coerce(p.kind, values[p.name]));
      const res = await read(method.name, args);
      setOut(pretty(res));
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="console-body">
      <div className="field">
        <label>view method</label>
        <select value={idx} onChange={(e) => { setIdx(Number(e.target.value)); setValues({}); setOut(null); setErr(null); }}>
          {READ_METHODS.map((m, i) => <option key={m.name} value={i}>{m.label}</option>)}
        </select>
      </div>
      <Params method={method} values={values} setValues={setValues} />
      <div><button className="btn primary" onClick={call} disabled={busy}>{busy ? "Reading…" : "Call (free, no wallet)"}</button></div>
      {err && <pre className="output err">{err}</pre>}
      {out && <pre className="output">{out}</pre>}
    </div>
  );
}

function WritePanel({ wallet }) {
  const [idx, setIdx] = useState(0);
  const method = WRITE_METHODS[idx];
  const [values, setValues] = useState({});
  const [tx, setTx] = useState({ hash: null, phase: null, done: false, failed: false, error: null });
  const [busy, setBusy] = useState(false);
  const { address, connect, connecting, wrongChain, available } = wallet;

  async function send() {
    setTx({ hash: null, phase: null, done: false, failed: false, error: null });
    setBusy(true);
    try {
      let value = 0n;
      const args = [];
      for (const p of method.params) {
        if (method.payableParam && p.name === method.payableParam) {
          value = coerce("atto", values[p.name]);
        } else {
          args.push(coerce(p.kind, values[p.name]));
        }
      }
      const hash = await write(address, method.name, args, value);
      setTx((t) => ({ ...t, hash, phase: "PENDING" }));
      const final = await pollTransaction(hash, (phase) => setTx((t) => ({ ...t, phase })));
      const failed = final === "UNDETERMINED" || final === "CANCELED";
      setTx((t) => ({ ...t, phase: final, done: !failed, failed }));
      wallet.onChange?.();
    } catch (e) {
      setTx((t) => ({ ...t, failed: true, error: e?.shortMessage || e?.message || String(e) }));
    } finally {
      setBusy(false);
    }
  }

  if (!available) {
    return (
      <div className="console-body">
        <div className="note">
          No EVM wallet detected. Install <a href="https://metamask.io" target="_blank" rel="noreferrer">MetaMask</a>{" "}
          (or any EIP-1193 wallet) and fund it with test GEN from the{" "}
          <a href="https://testnet-faucet.genlayer.foundation" target="_blank" rel="noreferrer">Bradbury faucet</a>{" "}
          to submit transactions. Reads work without a wallet.
        </div>
      </div>
    );
  }

  return (
    <div className="console-body">
      {!address ? (
        <div className="field">
          <button className="btn primary" onClick={connect} disabled={connecting}>
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
          <span className="hint">Adds & switches to Bradbury automatically. No MetaMask Snap required.</span>
        </div>
      ) : (
        <div className="wallet-pill"><span className="dot" /> {shortAddr(address)} {wrongChain && <span className="badge breach" style={{ marginLeft: 8 }}>wrong network, will switch on send</span>}</div>
      )}

      <div className="field">
        <label>write method</label>
        <select value={idx} onChange={(e) => { setIdx(Number(e.target.value)); setValues({}); }}>
          {WRITE_METHODS.map((m, i) => <option key={m.name} value={i}>{m.label}</option>)}
        </select>
        {method.note && <span className="hint">{method.note}</span>}
      </div>
      <Params method={method} values={values} setValues={setValues} />
      <div>
        <button className="btn primary" onClick={send} disabled={busy || !address}>
          {busy ? "Submitting…" : `Send ${method.name}()`}
        </button>
      </div>
      <TxStatus {...tx} />
    </div>
  );
}

export function Console({ wallet }) {
  const [tab, setTab] = useState("read");
  return (
    <div className="console">
      <div className="console-tabs">
        <button data-active={tab === "read"} onClick={() => setTab("read")}>Read</button>
        <button data-active={tab === "write"} onClick={() => setTab("write")}>Write</button>
      </div>
      <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line-soft)" }} className="muted mono">
        contract <a href={addrUrl(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">{shortAddr(CONTRACT_ADDRESS)}</a> · GenLayer Bradbury
      </div>
      {tab === "read" ? <ReadPanel /> : <WritePanel wallet={wallet} />}
    </div>
  );
}
