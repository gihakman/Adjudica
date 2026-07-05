import { txUrl } from "../lib/format.js";

export function TxStatus({ hash, phase, done, failed, error }) {
  if (!hash && !error) return null;
  const cls = failed ? "tx fail" : done ? "tx done" : "tx";
  return (
    <div className={cls}>
      {error ? (
        <div className="tx-row" style={{ color: "var(--breach)" }}>{error}</div>
      ) : (
        <>
          <div className="tx-row">
            {!done && <span className="spinner" />}
            <span className="tx-phase">
              {done ? "Consensus reached" : "Awaiting consensus"} · <b>{phase || "PENDING"}</b>
            </span>
          </div>
          {hash && (
            <div className="tx-row">
              <a className="link-explorer" href={txUrl(hash)} target="_blank" rel="noreferrer">
                {hash.slice(0, 14)}… ↗ view on explorer
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
