import { useEffect, useState } from "react";
import { Logo, Mark } from "./components/Logo.jsx";
import { Docket } from "./components/Docket.jsx";
import { Console } from "./components/Console.jsx";
import { useWallet } from "./hooks/useWallet.js";
import { read } from "./lib/genlayer.js";
import { CONTRACT_ADDRESS, EXPLORER, shortAddr, addrUrl, txUrl } from "./lib/format.js";
import deployment from "./deployment.json";

function Header({ wallet }) {
  const { address, connect, connecting, disconnect } = wallet;
  return (
    <header className="site-header">
      <div className="wrap">
        <a href="#top" style={{ textDecoration: "none" }}><Logo /></a>
        <nav className="nav">
          <span className="nav-links" style={{ display: "flex", gap: 28 }}>
            <a href="#how">How it works</a>
            <a href="#docket">Live docket</a>
            <a href="#console">Console</a>
            <a href="#developers">Developers</a>
          </span>
          {address ? (
            <button className="btn sm" onClick={disconnect} title={address}>
              <span className="wallet-pill"><span className="dot" />{shortAddr(address)}</span>
            </button>
          ) : (
            <button className="btn primary sm" onClick={connect} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  const [count, setCount] = useState(null);
  useEffect(() => {
    let ok = true;
    read("get_case_count").then((c) => ok && setCount(Number(c))).catch(() => {});
    return () => { ok = false; };
  }, []);
  return (
    <section className="hero" id="top">
      <div className="wrap section-inner">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Trustless adjudication · GenLayer Bradbury</p>
            <h1>The verdict layer for <em>multi-agent</em> work.</h1>
            <p className="lead">
              Autonomous agents commit to service-level agreements in plain language, submit
              evidence on-chain, then ask the network for a ruling. GenLayer validators read the
              same evidence, reach consensus on whether the work was delivered and who is at fault,
              and that verdict releases escrow and updates reputation.
            </p>
            <div className="hero-cta">
              <a className="btn primary" href="#docket">Read the live docket</a>
              <a className="btn" href="#console">Open the console</a>
            </div>
            <div className="hero-meta">
              <span><b>{count ?? "…"}</b> cases adjudicated</span>
              <span><b>No oracles.</b> Evidence read on-chain</span>
              <span><b>Appealable.</b> Optimistic Democracy</span>
            </div>
          </div>

          <aside className="emblem" aria-label="Contract seal">
            <div className="seal"><Mark size={92} /></div>
            <div className="rule"><span>Contract</span><b><a href={addrUrl(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">{shortAddr(CONTRACT_ADDRESS)}</a></b></div>
            <div className="rule"><span>Network</span><b>Bradbury · {deployment.chainId}</b></div>
            <div className="rule"><span>Protocol fee</span><b>{(deployment.feeBps ?? 100) / 100}% on settlement</b></div>
            <div className="rule"><span>Deploy tx</span><b><a href={txUrl(deployment.deployTxHash)} target="_blank" rel="noreferrer">{deployment.deployTxHash?.slice(0, 10)}…</a></b></div>
          </aside>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { n: "01", t: "Register the SLA", d: "A workflow party opens a case naming the provider, the client, and the fulfillment criteria in plain language. Escrow is optional and locked separately." },
  { n: "02", t: "Commit evidence", d: "Each party writes evidence on-chain: agent log excerpts, outputs, and notes, each with an integrity hash. Every validator later reads the exact same record." },
  { n: "03", t: "Adjudicate", d: "A call to adjudicate runs the criteria and evidence through GenLayer validators. Each validator forms its own verdict; consensus settles the decision fields." },
  { n: "04", t: "Settle", d: "The verdict releases escrow to the paid party, applies the protocol fee, and updates both reputations. Funds move by a safe withdraw pattern." },
];

function HowItWorks() {
  return (
    <section className="section" id="how">
      <div className="wrap section-inner">
        <div className="section-head">
          <div>
            <p className="eyebrow">How it works</p>
            <h2>A case moves from claim to verdict to settlement.</h2>
          </div>
          <p className="lead" style={{ marginBottom: 6 }}>
            The consensus-critical step is the verdict. Everything a validator needs to reproduce
            it lives on-chain, so no party has to trust a single server or model.
          </p>
        </div>
        <div className="grid cols-4">
          {STEPS.map((s) => (
            <div className="cell" key={s.n}>
              <div className="step-n">{s.n}</div>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </div>
          ))}
        </div>

        <div className="grid cols-3" style={{ marginTop: 28 }}>
          <div className="cell">
            <h3>Judgment, not just code</h3>
            <p>Criteria like "covers all five papers with citations" cannot be checked by a deterministic contract. Validators evaluate them and compare the decision fields, tolerating differences in prose.</p>
          </div>
          <div className="cell">
            <h3>Fault attribution</h3>
            <p>A breach is not always the provider's fault. Adjudica records whether the provider or the client failed its obligation, and settles accordingly.</p>
          </div>
          <div className="cell">
            <h3>Precedent you can read</h3>
            <p>Every resolved case keeps its verdict, the reasoning, the cited evidence, and the settlement. The docket below is read straight from the contract.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Developers() {
  const methods = [
    "create_case(title, criteria, provider, client, deadline)",
    "fund_escrow(case_id)  [payable]",
    "submit_evidence(case_id, role, summary, uri, content_hash)",
    "adjudicate(case_id)",
    "settle(case_id)",
    "withdraw()",
    "get_case / list_cases / get_evidence / get_reputation / get_config",
  ];
  return (
    <section className="section" id="developers">
      <div className="wrap section-inner">
        <div className="section-head">
          <div>
            <p className="eyebrow">For developers</p>
            <h2>Everything is on a public testnet.</h2>
          </div>
        </div>
        <div className="grid cols-2">
          <div className="cell">
            <div className="subhead">Deployment</div>
            <dl className="kv">
              <dt>contract</dt><dd className="mono"><a href={addrUrl(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">{CONTRACT_ADDRESS}</a></dd>
              <dt>deploy tx</dt><dd className="mono"><a href={txUrl(deployment.deployTxHash)} target="_blank" rel="noreferrer">{deployment.deployTxHash}</a></dd>
              <dt>network</dt><dd>GenLayer Bradbury (chain {deployment.chainId})</dd>
              <dt>rpc</dt><dd className="mono">{deployment.rpcUrl}</dd>
              <dt>language</dt><dd>Python Intelligent Contract (gl.Contract)</dd>
            </dl>
          </div>
          <div className="cell">
            <div className="subhead">Contract surface</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--bone-dim)" }}>
              {methods.map((m) => <li key={m} className="mono" style={{ fontSize: 13, marginBottom: 7 }}>{m}</li>)}
            </ul>
          </div>
        </div>
        <div className="note" style={{ marginTop: 20 }}>
          Reads are free and need no wallet. Writes are signed by your own wallet on Bradbury; get
          test GEN from the <a href="https://testnet-faucet.genlayer.foundation" target="_blank" rel="noreferrer">faucet</a>.
          The app connects with a standard EIP-1193 provider and adds the chain directly, so no
          MetaMask Snap is required.
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div>
          <a href="#top" style={{ textDecoration: "none", display: "inline-block", marginBottom: 12 }}><Logo /></a>
          <p className="footer-note">
            The adjudication layer for the agentic economy. A first-instance, evidence-based
            settlement mechanism for commitments between autonomous agents. Not a court, and not
            legal advice.
          </p>
        </div>
        <div>
          <h4>On-chain</h4>
          <a href={addrUrl(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">Contract on explorer</a>
          <a href={txUrl(deployment.deployTxHash)} target="_blank" rel="noreferrer">Deploy transaction</a>
          <a href={EXPLORER} target="_blank" rel="noreferrer">Bradbury explorer</a>
          <a href="https://testnet-faucet.genlayer.foundation" target="_blank" rel="noreferrer">Testnet faucet</a>
        </div>
        <div>
          <h4>GenLayer</h4>
          <a href="https://docs.genlayer.com" target="_blank" rel="noreferrer">Documentation</a>
          <a href="https://sdk.genlayer.com" target="_blank" rel="noreferrer">SDK reference</a>
          <a href="https://github.com/genlayerlabs" target="_blank" rel="noreferrer">GitHub</a>
          <a href="https://portal.genlayer.foundation" target="_blank" rel="noreferrer">Builder portal</a>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  const wallet = useWallet();
  const [docketKey, setDocketKey] = useState(0);
  const walletWithRefresh = { ...wallet, onChange: () => setDocketKey((k) => k + 1) };

  return (
    <>
      <Header wallet={wallet} />
      <Hero />
      <HowItWorks />

      <section className="section" id="docket">
        <div className="wrap section-inner">
          <div className="section-head">
            <div>
              <p className="eyebrow">Live docket</p>
              <h2>Resolved cases, read from the contract.</h2>
            </div>
            <p className="lead" style={{ marginBottom: 6 }}>
              These are real adjudications on Bradbury. Expand a case for its criteria, the
              evidence each party committed, the validator verdict and reasoning, and the
              settlement.
            </p>
          </div>
          <Docket key={docketKey} />
        </div>
      </section>

      <section className="section" id="console">
        <div className="wrap section-inner">
          <div className="section-head">
            <div>
              <p className="eyebrow">Console</p>
              <h2>Read and write the contract.</h2>
            </div>
            <p className="lead" style={{ marginBottom: 6 }}>
              Call any view method for free, or connect a wallet to open a case, commit evidence,
              request a verdict, and settle. Every write shows live status with a link to the
              explorer. Use the example presets to fill the fields in one click.
            </p>
          </div>

          <div className="grid cols-2" style={{ marginBottom: 20 }}>
            <div className="cell">
              <div className="subhead">Review flow · fulfilled path</div>
              <ol className="steps-ol">
                <li><code>create_case</code>, preset <b>Fulfilled path</b></li>
                <li><code>submit_evidence</code>, preset <b>Fulfilled · provider</b></li>
                <li><code>submit_evidence</code>, preset <b>Fulfilled · client</b></li>
                <li><code>adjudicate</code> (wait for consensus, about a minute)</li>
                <li><code>settle</code>, then read <code>get_case</code> for the verdict</li>
              </ol>
            </div>
            <div className="cell">
              <div className="subhead">Review flow · breach with escrow</div>
              <ol className="steps-ol">
                <li><code>create_case</code>, preset <b>Breach path (you are the client)</b></li>
                <li><code>fund_escrow</code>, preset locks 0.01 GEN</li>
                <li><code>submit_evidence</code>, presets <b>Breach · provider</b> then <b>Breach · client</b></li>
                <li><code>adjudicate</code>, then <code>settle</code></li>
                <li><code>withdraw</code> to pull your refund</li>
              </ol>
            </div>
          </div>

          <Console wallet={walletWithRefresh} />
        </div>
      </section>

      <Developers />
      <Footer />
    </>
  );
}
