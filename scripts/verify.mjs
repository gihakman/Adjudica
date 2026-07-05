// Read the live contract state back from Bradbury: config, every case, its
// evidence, and the reputation of each party. Used to verify seeding end-to-end.
import { makeClient, loadDeployment, retry, attoToGen, EXPLORER } from "./common.mjs";

async function main() {
  const dep = loadDeployment();
  const { client } = makeClient();
  const addr = dep.contractAddress;
  const read = (fn, args = []) =>
    retry(() => client.readContract({ address: addr, functionName: fn, args }), { label: fn });

  console.log("Contract:", addr);
  console.log("Explorer:", `${EXPLORER}/address/${addr}`);
  console.log("Config:  ", JSON.stringify(await read("get_config")));

  const count = Number(await read("get_case_count"));
  console.log(`\nCases on-chain: ${count}\n`);
  const cases = await read("list_cases", [0, count]);
  const parties = new Set();

  for (const c of cases.slice().reverse()) {
    console.log(`#${c.id}  ${c.title}`);
    console.log(`     status=${c.status} fulfilled=${c.fulfilled} fault=${c.fault_party} confidence=${c.confidence}`);
    console.log(`     provider=${c.provider} client=${c.client}`);
    console.log(`     escrow=${attoToGen(c.escrow_atto)} payout=${attoToGen(c.payout_atto)} fee=${attoToGen(c.fee_atto)} GEN beneficiary=${c.beneficiary}`);
    if (c.reasoning) console.log(`     reasoning: ${c.reasoning}`);
    const ev = await read("get_evidence", [c.id]);
    console.log(`     evidence: ${ev.length} entries`);
    parties.add(c.provider.toLowerCase());
    parties.add(c.client.toLowerCase());
  }

  console.log("\nReputations:");
  for (const p of parties) {
    const r = await read("get_reputation", [p]);
    console.log(`  ${p}  score=${r.score} fulfilled=${r.fulfilled} breached=${r.breached} fault=${r.fault} cases=${r.cases}`);
  }
  console.log("\n✅ Live read complete.");
}

main().catch((e) => { console.error("verify failed:", e?.message ?? e); process.exit(1); });
