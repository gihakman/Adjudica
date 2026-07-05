// Seed real end-to-end Adjudica cases on Bradbury.
// Lifecycle per case: create_case -> [fund_escrow] -> submit_evidence(x2)
//                     -> adjudicate (real LLM consensus) -> settle -> [withdraw].
//
// Idempotent + resumable: state is re-derived from on-chain reads on every run, so
// interrupted runs can be safely re-invoked. Process one case per invocation:
//   node seed.mjs 1        # seed case 1
//   node seed.mjs all      # seed all cases sequentially
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  makeClient, loadDeployment, retry, sleep, genToAtto, attoToGen,
  AGENTS, EXPLORER, TransactionStatus,
} from "./common.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, "seed-state.json");

function sha256(text) {
  return "0x" + crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function loadState() {
  if (fs.existsSync(STATE_PATH)) return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  return { cases: {} };
}
function saveState(s) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2) + "\n");
}

// ---- Case plans (evidence crafted to be clear-cut so consensus is stable) ----
function plans(deployer) {
  return [
    {
      key: "synthesis",
      title: "Literature synthesis: 5-paper agentic-commerce review",
      criteria:
        "Provider must deliver a synthesis report of at least 800 words that summarizes all five assigned source papers, includes at least one inline citation per paper, and is submitted before the 2026-08-01 deadline.",
      provider: AGENTS.synthesizer,
      client: deployer,
      deadline: "2026-08-01",
      escrowGen: "0.01",
      withdraw: false, // provider (an agent) is paid; credit stays claimable by them
      evidence: [
        { role: "provider", summary:
          "Delivered synthesis_report_v3.md (1,247 words). Sections cover all five assigned papers: [1] x402 payments, [2] ERC-8004 identity, [3] A2A interoperability, [4] ACP checkout, [5] AP2. 14 inline citations, at least one per paper. Submitted 2026-07-06, before the 2026-08-01 deadline. Automated checks wordcount>=800 PASS and citations>=5 PASS." },
        { role: "client", summary:
          "Client (orchestrator) confirms receipt of synthesis_report_v3.md on 2026-07-06. Verified that all five source papers are summarized and each is cited inline. The deliverable matches the agreed criteria." },
      ],
    },
    {
      key: "etl",
      title: "ETL pipeline delivery: normalized events dataset",
      criteria:
        "Provider must deliver a normalized events dataset covering the full 30-day window with zero null primary keys and an attached validation report, before the 2026-07-05 deadline.",
      provider: AGENTS.pipeline,
      client: deployer,
      deadline: "2026-07-05",
      escrowGen: "0.02",
      withdraw: true, // breach + provider fault -> client (deployer) refunded, then withdraws
      evidence: [
        { role: "provider", summary:
          "Delivered events_partial.parquet covering only 11 of the required 30 days. No validation report was attached. The job aborted after an unhandled schema exception on day 12 and was not retried." },
        { role: "client", summary:
          "Client review: the dataset covers 11/30 days, contains 4,182 rows with null primary keys, and includes no validation report. The deliverable does not meet the criteria. The shortfall is due to the provider's failed pipeline run; all required client inputs were supplied on time." },
      ],
    },
    {
      key: "moderation",
      title: "Content moderation SLA: policy-cited decisions",
      criteria:
        "Provider must return moderation decisions for all 200 queued items within the 24-hour SLA, and every flagged item must cite the specific policy rule it violated.",
      provider: AGENTS.moderator,
      client: AGENTS.scholar,
      deadline: "2026-07-08",
      escrowGen: null,
      withdraw: false,
      evidence: [
        { role: "provider", summary:
          "Processed all 200 queued items in 6h47m, within the 24-hour SLA. 23 items were flagged and each flag cites the specific violated rule (for example R-4 harassment, R-7 PII exposure). Output log moderation_run_88.json is attached." },
        { role: "observer", summary:
          "Independent audit of 40 sampled decisions: 40/40 were consistent with the cited policy rules. All 200 items have a recorded decision and a timestamp inside the SLA window." },
      ],
    },
    {
      key: "ranking",
      title: "Ranking model refresh: blocked on client dataset",
      criteria:
        "Provider must deliver a refreshed ranking model within 24 hours of the client delivering the labeled training dataset.",
      provider: AGENTS.ranker,
      client: AGENTS.synthesizer,
      deadline: "2026-07-07",
      escrowGen: null,
      withdraw: false,
      evidence: [
        { role: "provider", summary:
          "Provider was ready and requested the labeled training dataset on 2026-07-04, 07-05, and 07-06. The 24-hour delivery window is explicitly conditioned on receiving that dataset. As of the deadline the dataset had not been delivered, so training could not begin." },
        { role: "client", summary:
          "Client acknowledges the labeled training dataset was never handed to the provider, due to an internal export failure on the client side. No dataset was delivered at any point." },
      ],
    },
    {
      key: "handoff",
      title: "Multi-agent report handoff: undelivered final compliance report",
      criteria:
        "The workflow requires the provider to deliver the final merged compliance report by the 2026-07-06 deadline. Under the agreed terms the client must supply the approved report template and the provider must merge the section drafts into it. If the final report is not delivered by the deadline the SLA is breached, and fault must be attributed to whichever party failed its own obligation.",
      provider: AGENTS.moderator,
      client: AGENTS.scholar,
      deadline: "2026-07-06",
      escrowGen: null,
      withdraw: false,
      evidence: [
        { role: "provider", summary:
          "Provider completed all three section drafts on 2026-07-03 and uploaded them to the shared workspace. The final merge requires the client's approved report template. The provider requested that template on 2026-07-03, 07-04, and 07-05. The template was never received, so the final merged report could not be produced." },
        { role: "client", summary:
          "Client acknowledges it never supplied the approved report template before the deadline, due to an unresolved internal approval backlog on the client side. Consequently the final merged compliance report was not delivered by the 2026-07-06 deadline. The provider's section drafts were complete and on time." },
      ],
    },
  ];
}

async function seedOne(ctx, plan) {
  const { client, addr } = ctx;
  const read = (fn, args = []) =>
    retry(() => client.readContract({ address: addr, functionName: fn, args }), { label: fn });
  const waitAccepted = (hash, retries = 90) =>
    client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, interval: 4000, retries });

  // submit() sends a write, retrying only on nonce/rate errors (which mean the tx
  // was rejected, not created). Before every attempt it runs isDone(); if the step
  // already took effect on-chain (e.g. a genuinely-pending tx landed), it skips —
  // so retries can never double-submit.
  async function submit(fn, args, { value = 0n, isDone, retries = 8, wait = 7000 } = {}) {
    for (let i = 0; i < retries; i++) {
      if (isDone && (await isDone())) return null;
      try {
        return await client.writeContract({ address: addr, functionName: fn, args, value });
      } catch (err) {
        const m = String(err?.message ?? err);
        if (/-32602|replace existing|nonce|already known|-32429|-32028|\b429\b|rate.?limit|reverted|timeout/i.test(m) && i < retries - 1) {
          console.warn(`  [retry ${fn}] ${m.split("\n")[0]}`);
          await sleep(wait);
          continue;
        }
        throw err;
      }
    }
    throw new Error(`submit(${fn}) exhausted retries`);
  }

  console.log(`\n=== Case '${plan.key}': ${plan.title} ===`);
  const cs = ctx.state.cases[plan.key] || {};
  ctx.state.cases[plan.key] = cs;

  // 1. Resolve or create the case (idempotent: match by title).
  if (!cs.id) {
    const count = Number(await read("get_case_count"));
    if (count > 0) {
      const existing = await read("list_cases", [0, count]);
      const match = (existing || []).find((c) => c.title === plan.title);
      if (match) cs.id = Number(match.id);
    }
  }
  if (!cs.id) {
    console.log("  create_case ...");
    const findByTitle = async () => {
      const count = Number(await read("get_case_count"));
      if (count === 0) return null;
      const existing = await read("list_cases", [0, count]);
      return (existing || []).find((c) => c.title === plan.title) || null;
    };
    const h = await submit("create_case", [plan.title, plan.criteria, plan.provider, plan.client, plan.deadline], {
      isDone: async () => (await findByTitle()) !== null,
    });
    if (h) await waitAccepted(h);
    const match = await findByTitle();
    cs.id = Number(match.id);
    if (h) cs.createTx = h;
    saveState(ctx.state);
    console.log("  case id", cs.id, h || "(already existed)");
  } else {
    console.log("  case id", cs.id, "(exists)");
  }
  const id = cs.id;
  await sleep(2000);

  // Sync live state to stay idempotent.
  let caseData = await read("get_case", [id]);

  // 2. Fund escrow.
  if (plan.escrowGen && !caseData.escrow_funded) {
    const value = genToAtto(plan.escrowGen);
    console.log(`  fund_escrow ${plan.escrowGen} GEN (${value} atto) ...`);
    const h = await submit("fund_escrow", [id], {
      value,
      isDone: async () => (await read("get_case", [id])).escrow_funded === true,
    });
    if (h) { await waitAccepted(h); cs.fundTx = h; saveState(ctx.state); }
    caseData = await read("get_case", [id]);
    await sleep(2000);
  }

  // 3. Evidence (submit any not yet on-chain).
  let have = ((await read("get_evidence", [id])) || []).length;
  while (have < plan.evidence.length) {
    const e = plan.evidence[have];
    const target = have + 1;
    console.log(`  submit_evidence #${target} (${e.role}) ...`);
    const h = await submit("submit_evidence", [id, e.role, e.summary, e.uri || "", sha256(e.summary)], {
      isDone: async () => ((await read("get_evidence", [id])) || []).length >= target,
    });
    if (h) { await waitAccepted(h); cs.evidenceTx = (cs.evidenceTx || []).concat(h); saveState(ctx.state); }
    have = ((await read("get_evidence", [id])) || []).length;
    await sleep(2000);
  }

  // 4. Adjudicate (real LLM consensus) unless already resolved.
  caseData = await read("get_case", [id]);
  if (caseData.status === "OPEN" || caseData.status === "SUBMITTED") {
    console.log("  adjudicate (LLM consensus, may take a minute) ...");
    const h = await submit("adjudicate", [id], {
      isDone: async () => {
        const s = (await read("get_case", [id])).status;
        return s === "RESOLVED" || s === "SETTLED";
      },
    });
    if (h) { await waitAccepted(h, 150); cs.adjudicateTx = h; saveState(ctx.state); }
    caseData = await read("get_case", [id]);
    if (caseData.status !== "RESOLVED" && caseData.status !== "SETTLED") {
      throw new Error(`adjudicate did not resolve (status=${caseData.status}). Re-run to retry.`);
    }
    console.log(`  verdict: fulfilled=${caseData.fulfilled} fault=${caseData.fault_party} confidence=${caseData.confidence}`);
    await sleep(2000);
  } else {
    console.log(`  already ${caseData.status}: fulfilled=${caseData.fulfilled} fault=${caseData.fault_party}`);
  }

  // 5. Settle.
  if (caseData.status === "RESOLVED") {
    console.log("  settle ...");
    const h = await submit("settle", [id], {
      isDone: async () => (await read("get_case", [id])).status === "SETTLED",
    });
    if (h) { await waitAccepted(h); cs.settleTx = h; saveState(ctx.state); }
    caseData = await read("get_case", [id]);
    console.log(`  settled: beneficiary=${caseData.beneficiary} payout=${attoToGen(caseData.payout_atto)} fee=${attoToGen(caseData.fee_atto)} GEN`);
    await sleep(2000);
  }

  // 6. Withdraw (only where the deployer is the beneficiary).
  if (plan.withdraw && !cs.withdrawTx) {
    const pending = await read("get_pending_withdrawal", [ctx.account.address]);
    if (BigInt(pending) > 0n) {
      console.log(`  withdraw ${attoToGen(pending)} GEN to deployer ...`);
      const h = await submit("withdraw", [], {
        isDone: async () => BigInt(await read("get_pending_withdrawal", [ctx.account.address])) === 0n,
      });
      if (h) { await waitAccepted(h); cs.withdrawTx = h; saveState(ctx.state); }
      console.log("  withdrawn (value settles on finalization)");
    }
  }

  cs.summary = {
    id, status: caseData.status, fulfilled: caseData.fulfilled, fault_party: caseData.fault_party,
    escrow_atto: caseData.escrow_atto, payout_atto: caseData.payout_atto, fee_atto: caseData.fee_atto,
  };
  saveState(ctx.state);
  console.log(`  done: case ${id} -> ${caseData.status}`);
}

async function main() {
  const arg = (process.argv[2] || "all").toLowerCase();
  const dep = loadDeployment();
  const { client, account } = makeClient();
  const ctx = { client, account, addr: dep.contractAddress, state: loadState() };
  console.log("Contract:", dep.contractAddress, `(${EXPLORER}/address/${dep.contractAddress})`);
  console.log("Seeder:  ", account.address);

  const all = plans(account.address);
  const indices = arg === "all" ? all.map((_, i) => i) : [Number.parseInt(arg, 10) - 1];
  for (const i of indices) {
    if (i < 0 || i >= all.length) throw new Error(`invalid case index: ${arg}`);
    await seedOne(ctx, all[i]);
    if (arg === "all" && i < all.length - 1) await sleep(2000);
  }

  const count = Number(await retry(() => client.readContract({ address: ctx.addr, functionName: "get_case_count", args: [] }), { label: "count" }));
  console.log(`\n✅ Seeding step complete. On-chain case count: ${count}`);
}

main().catch((err) => {
  console.error("\n❌ Seed failed:", err?.message ?? err);
  process.exit(1);
});
