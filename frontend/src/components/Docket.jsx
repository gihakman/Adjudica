import { useEffect, useState, useCallback } from "react";
import { read } from "../lib/genlayer.js";
import { shortAddr, attoToGen, addrUrl } from "../lib/format.js";

function StatusBadge({ status }) {
  return (
    <span className="badge status"><span className="dot" />{status}</span>
  );
}

function VerdictBadge({ c }) {
  if (c.status !== "RESOLVED" && c.status !== "SETTLED") {
    return <span className="badge brass">Awaiting verdict</span>;
  }
  return c.fulfilled ? (
    <span className="badge verdict"><span className="dot" />Fulfilled</span>
  ) : (
    <span className="badge breach"><span className="dot" />Breach · fault {c.fault_party}</span>
  );
}

function Reputation({ address }) {
  const [rep, setRep] = useState(null);
  useEffect(() => {
    let ok = true;
    read("get_reputation", [address]).then((r) => ok && setRep(r)).catch(() => {});
    return () => { ok = false; };
  }, [address]);
  if (!rep) return null;
  return (
    <div className="rep">
      <div className="score">{rep.score}<small>/100</small></div>
      <a className="addr" href={addrUrl(address)} target="_blank" rel="noreferrer">{shortAddr(address)}</a>
      <div className="muted mono" style={{ fontSize: 11, marginTop: 4 }}>
        {rep.fulfilled}✓ · {rep.breached}✗ · {rep.fault} fault · {rep.cases} cases
      </div>
    </div>
  );
}

function CaseRow({ c }) {
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState(null);

  const onToggle = useCallback((e) => {
    const isOpen = e.target.open;
    setOpen(isOpen);
    if (isOpen && evidence === null) {
      read("get_evidence", [c.id]).then(setEvidence).catch(() => setEvidence([]));
    }
  }, [c.id, evidence]);

  const resolved = c.status === "RESOLVED" || c.status === "SETTLED";
  const escrow = attoToGen(c.escrow_atto);

  return (
    <details className="case" onToggle={onToggle}>
      <summary>
        <span className="case-id">#{c.id}</span>
        <span>
          <span className="case-title">{c.title}</span>
          <div className="case-sub">
            provider {shortAddr(c.provider)} · client {shortAddr(c.client)}
            {escrow !== "0" ? ` · escrow ${escrow} GEN` : " · no escrow"}
          </div>
        </span>
        <span className="case-tags">
          <VerdictBadge c={c} />
          <StatusBadge status={c.status} />
        </span>
      </summary>

      <div className="case-body">
        <div>
          <div className="subhead">SLA criteria</div>
          <p style={{ margin: 0, color: "var(--bone)" }}>{c.criteria}</p>
        </div>

        {resolved && (
          <div className={`verdict-panel ${c.fulfilled ? "ok" : "no"}`}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <VerdictBadge c={c} />
              <span className="mono muted" style={{ fontSize: 12 }}>confidence {c.confidence}/100</span>
            </div>
            {c.reasoning && <p className="reason">“{c.reasoning}”</p>}
          </div>
        )}

        <div>
          <div className="subhead">Evidence {open && evidence ? `(${evidence.length})` : ""}</div>
          <div className="evidence">
            {evidence === null && <div className="spin-load"><span className="spinner" />loading evidence…</div>}
            {evidence && evidence.length === 0 && <div className="muted">No evidence recorded.</div>}
            {evidence && evidence.map((e, i) => (
              <div className="ev" key={i}>
                <div className="ev-head">
                  <span className="ev-role">{e.role}</span>
                  <span className="muted mono" style={{ fontSize: 11 }}>{shortAddr(e.submitter)}</span>
                </div>
                <p>{e.summary}</p>
                {e.content_hash && <div className="hash">sha256 {e.content_hash}</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="row">
          <div>
            <div className="subhead">Settlement</div>
            <dl className="kv">
              <dt>escrow</dt><dd>{escrow} GEN</dd>
              <dt>beneficiary</dt><dd className="mono">{c.status === "SETTLED" ? shortAddr(c.beneficiary) : "not settled"}</dd>
              <dt>payout</dt><dd>{attoToGen(c.payout_atto)} GEN</dd>
              <dt>protocol fee</dt><dd>{attoToGen(c.fee_atto)} GEN</dd>
            </dl>
          </div>
          <div>
            <div className="subhead">Reputations</div>
            <div className="reps">
              <Reputation address={c.provider} />
              <Reputation address={c.client} />
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}

export function Docket() {
  const [cases, setCases] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const count = Number(await read("get_case_count"));
      if (count === 0) { setCases([]); return; }
      const list = await read("list_cases", [0, count]); // newest-first, single call
      setCases(list);
    } catch (e) {
      setError(e?.message || String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      {error && (
        <div className="banner" style={{ marginBottom: 16 }}>
          Could not read the contract right now: {error}{" "}
          <button className="btn sm ghost" onClick={load} style={{ marginLeft: 8 }}>Retry</button>
        </div>
      )}
      {cases === null && !error && (
        <div className="spin-load"><span className="spinner" />reading the docket from Bradbury…</div>
      )}
      {cases && cases.length === 0 && <div className="muted">No cases on-chain yet.</div>}
      <div className="docket">
        {cases && cases.map((c) => <CaseRow key={c.id} c={c} />)}
      </div>
    </div>
  );
}
