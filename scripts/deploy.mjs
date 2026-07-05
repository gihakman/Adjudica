// Deploy Adjudica to GenLayer Bradbury, then verify it is live by reading a view
// method. Records the contract address and deploy tx hash for the app and seeding.
import {
  makeClient, feeConfig, readContractSource, saveDeployment, retry,
  getBalanceAtto, attoToGen, EXPLORER, TransactionStatus,
} from "./common.mjs";

async function main() {
  const { client, account } = makeClient();
  const { feeBps, feeRecipient } = feeConfig();

  console.log("Network:      Bradbury (chainId 4221)");
  console.log("Deployer:    ", account.address);
  const balance = await retry(() => getBalanceAtto(client, account.address), { label: "getBalance" });
  console.log("Balance:      " + attoToGen(balance) + " GEN");
  if (balance === 0n) {
    throw new Error("Deployer balance is 0 GEN. Fund it via https://testnet-faucet.genlayer.foundation before deploying.");
  }
  console.log("Fee (bps):   ", feeBps, feeRecipient ? `-> ${feeRecipient}` : "-> deployer");

  await retry(() => client.initializeConsensusSmartContract(), { label: "initConsensus" });

  console.log("\nDeploying contracts/adjudica.py ...");
  const code = readContractSource();
  const hash = await client.deployContract({ code, args: [feeBps, feeRecipient] });
  console.log("Deploy tx:   ", hash);
  console.log("Explorer:     " + `${EXPLORER}/tx/${hash}`);

  console.log("\nWaiting for consensus acceptance ...");
  const receipt = await client.waitForTransactionReceipt({
    hash, status: TransactionStatus.ACCEPTED, interval: 5000, retries: 80,
  });
  const contractAddress = receipt.recipient || receipt?.txDataDecoded?.contractAddress;
  if (!contractAddress) {
    throw new Error("Could not determine contract address from receipt: " + JSON.stringify(receipt).slice(0, 500));
  }
  console.log("Status:      ", receipt.statusName ?? receipt.status);
  console.log("Execution:   ", receipt.txExecutionResultName ?? "n/a");
  console.log("Contract:    ", contractAddress);

  // Verify LIVE by reading a view method (not trusting "accepted" alone).
  console.log("\nVerifying live via get_config() ...");
  const cfg = await retry(
    () => client.readContract({ address: contractAddress, functionName: "get_config", args: [] }),
    { label: "get_config" },
  );
  console.log("get_config:  ", JSON.stringify(cfg));
  if (!cfg || cfg.owner?.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("Verification failed: get_config did not return the expected owner.");
  }

  saveDeployment({
    network: "bradbury",
    chainId: 4221,
    rpcUrl: "https://rpc-bradbury.genlayer.com",
    explorer: EXPLORER,
    contractAddress,
    deployTxHash: hash,
    deployedAt: new Date().toISOString(),
    feeBps: Number(cfg.fee_bps),
    feeRecipient: cfg.fee_recipient,
    owner: cfg.owner,
  });

  console.log("\n✅ Deployed and verified live.");
  console.log("   Contract:  " + `${EXPLORER}/address/${contractAddress}`);
  console.log("   Saved to scripts/deployment.json and frontend/src/deployment.json");
}

main().catch((err) => {
  console.error("\n❌ Deploy failed:", err?.message ?? err);
  process.exit(1);
});
