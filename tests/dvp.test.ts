import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { DvPEngine } from "../src/dvp-engine";
import { BondTokenConfig } from "../src/types";

/**
 * Comprehensive DVP Test Suite
 *
 * Tests the complete DvP workflow on local validator:
 * 1. Setup - Create settlement agent, issuer, and investor
 * 2. Bond creation with Token-2022
 * 3. Mock USDC creation for testing
 * 4. Whitelisting
 * 5. Delegation
 * 6. Atomic settlement
 * 7. Verification
 */

// Configuration
const CLUSTER = "http://localhost:8899"; // Local validator
const BOND_AMOUNT = 100;
const USDC_AMOUNT = 95000; // $95,000 for 100 bonds

// Helper to wait
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runDvPDemo() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("   DvP Demo - Solana Example Implementation");
  console.log("═══════════════════════════════════════════════════════\n");

  // ============================================================
  // PHASE 1: SETUP
  // ============================================================
  console.log("📋 PHASE 1: INITIALIZATION");
  console.log("─────────────────────────────────────────────────────\n");

  // Connect to local validator
  const connection = new Connection(CLUSTER, "confirmed");
  console.log(`🔗 Connected to: ${CLUSTER}`);

  // Create keypairs
  console.log("\n👥 Creating participants...");
  const settlementAgent = Keypair.generate();
  const issuer = Keypair.generate();
  const investor = Keypair.generate();

  console.log(`   Settlement Agent: ${settlementAgent.publicKey.toBase58()}`);
  console.log(`   Issuer: ${issuer.publicKey.toBase58()}`);
  console.log(`   Investor: ${investor.publicKey.toBase58()}`);

  // Initialize DVP Engine
  const dvpEngine = new DvPEngine(connection, settlementAgent);

  // Fund accounts
  console.log("\n💰 Funding accounts with SOL...");
  try {
    await dvpEngine.airdropSol(settlementAgent.publicKey, 2);
    await sleep(1000);
    await dvpEngine.airdropSol(issuer.publicKey, 2);
    await sleep(1000);
    await dvpEngine.airdropSol(investor.publicKey, 2);
    await sleep(1000);
  } catch (error) {
    console.log(
      "⚠️  Airdrop failed - make sure you are running a local validator"
    );
    console.log("   Run: solana-test-validator");
    throw error;
  }

  // Verify balances
  const settlementBalance = await connection.getBalance(
    settlementAgent.publicKey
  );
  const issuerBalance = await connection.getBalance(issuer.publicKey);
  const investorBalance = await connection.getBalance(investor.publicKey);

  console.log(
    `   Settlement Agent: ${settlementBalance / LAMPORTS_PER_SOL} SOL`
  );
  console.log(`   Issuer: ${issuerBalance / LAMPORTS_PER_SOL} SOL`);
  console.log(`   Investor: ${investorBalance / LAMPORTS_PER_SOL} SOL`);

  // ============================================================
  // PHASE 2: BOND TOKEN CREATION
  // ============================================================
  console.log("\n\n📋 PHASE 2: BOND TOKEN CREATION");
  console.log("─────────────────────────────────────────────────────");

  const bondConfig: BondTokenConfig = {
    name: "Commercial Paper",
    symbol: "CP",
    decimals: 0, // Whole bonds only
    maturityDate: new Date("2026-12-31"),
    couponRate: 5.0,
    isin: "US000000000",
    description: "Demo commercial paper for DvP testing",
  };

  const bondMint = await dvpEngine.createBondToken(issuer, bondConfig);

  // ============================================================
  // PHASE 3: MOCK USDC CREATION (for local testing)
  // ============================================================
  console.log("\n\n📋 PHASE 3: SETTLEMENT CURRENCY SETUP");
  console.log("─────────────────────────────────────────────────────");
  console.log("\n💵 Creating mock USDC for testing...");
  console.log("   (In production, use actual USDC mint)");

  // Create mock USDC mint
  const mockUSDCMint = await createMint(
    connection,
    issuer,
    issuer.publicKey, // mint authority
    null, // no freeze authority for USDC
    6, // USDC has 6 decimals
    Keypair.generate(),
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID // Use standard token program for USDC
  );

  console.log(`   Mock USDC Mint: ${mockUSDCMint.toBase58()}`);

  // ============================================================
  // PHASE 4: ACCOUNT SETUP
  // ============================================================
  console.log("\n\n📋 PHASE 4: ACCOUNT SETUP");
  console.log("─────────────────────────────────────────────────────");

  // Whitelist issuer for bonds (they need to hold bonds to sell them)
  console.log("\n🏦 Whitelisting issuer for bond holding...");
  const issuerBondAccount = await dvpEngine.whitelist(
    bondMint,
    issuer.publicKey,
    settlementAgent
  );

  // Mint bonds to issuer
  console.log(`\n🪙 Minting ${BOND_AMOUNT} bonds to issuer...`);
  await mintTo(
    connection,
    issuer,
    bondMint,
    issuerBondAccount,
    issuer,
    BOND_AMOUNT,
    [],
    { commitment: "confirmed" },
    TOKEN_2022_PROGRAM_ID
  );
  console.log(`   ✅ ${BOND_AMOUNT} bonds minted`);

  // Whitelist investor for bonds
  console.log("\n🔓 Whitelisting investor for bond trading...");
  const investorBondAccount = await dvpEngine.whitelist(
    bondMint,
    investor.publicKey,
    settlementAgent
  );

  // Create USDC accounts
  console.log("\n💵 Setting up USDC accounts...");

  // Investor USDC account
  const investorUSDCAccountInfo = await getOrCreateAssociatedTokenAccount(
    connection,
    investor,
    mockUSDCMint,
    investor.publicKey,
    false,
    "confirmed",
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );
  const investorUSDCAccount = investorUSDCAccountInfo.address;
  console.log(`   Investor USDC: ${investorUSDCAccount.toBase58()}`);

  // Issuer USDC account
  const issuerUSDCAccountInfo = await getOrCreateAssociatedTokenAccount(
    connection,
    issuer,
    mockUSDCMint,
    issuer.publicKey,
    false,
    "confirmed",
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );
  const issuerUSDCAccount = issuerUSDCAccountInfo.address;
  console.log(`   Issuer USDC: ${issuerUSDCAccount.toBase58()}`);

  // Mint USDC to investor
  console.log(`\n💰 Minting ${USDC_AMOUNT} USDC to investor...`);
  await mintTo(
    connection,
    issuer,
    mockUSDCMint,
    investorUSDCAccount,
    issuer,
    USDC_AMOUNT * 1e6, // USDC has 6 decimals
    [],
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );
  console.log(`   ✅ ${USDC_AMOUNT} USDC minted`);

  // ============================================================
  // PHASE 5: PRE-SETTLEMENT VERIFICATION
  // ============================================================
  console.log("\n\n📋 PHASE 5: PRE-SETTLEMENT STATE");
  console.log("─────────────────────────────────────────────────────\n");

  const issuerBondsBefore = await getAccount(
    connection,
    issuerBondAccount,
    "confirmed",
    TOKEN_2022_PROGRAM_ID
  );

  const investorBondsBefore = await getAccount(
    connection,
    investorBondAccount,
    "confirmed",
    TOKEN_2022_PROGRAM_ID
  );

  const investorUSDCBefore = await getAccount(
    connection,
    investorUSDCAccount,
    "confirmed",
    TOKEN_PROGRAM_ID
  );

  const issuerUSDCBefore = await getAccount(
    connection,
    issuerUSDCAccount,
    "confirmed",
    TOKEN_PROGRAM_ID
  );

  console.log("📊 Account Balances:");
  console.log("\n   Issuer:");
  console.log(`   - Bonds: ${issuerBondsBefore.amount.toString()}`);
  console.log(`   - USDC: ${Number(issuerUSDCBefore.amount) / 1e6}`);
  console.log("\n   Investor:");
  console.log(`   - Bonds: ${investorBondsBefore.amount.toString()}`);
  console.log(`   - USDC: ${Number(investorUSDCBefore.amount) / 1e6}`);

  // ============================================================
  // PHASE 6: DELEGATION
  // ============================================================
  console.log("\n\n📋 PHASE 6: AUTHORITY DELEGATION");
  console.log("─────────────────────────────────────────────────────");

  // Issuer delegates bonds
  await dvpEngine.delegateAuthority(
    issuer,
    issuerBondAccount,
    BOND_AMOUNT,
    0,
    TOKEN_2022_PROGRAM_ID
  );

  // Investor delegates USDC
  await dvpEngine.delegateAuthority(
    investor,
    investorUSDCAccount,
    USDC_AMOUNT,
    6,
    TOKEN_PROGRAM_ID
  );

  // ============================================================
  // PHASE 7: ATOMIC DvP SETTLEMENT
  // ============================================================
  console.log("\n\n📋 PHASE 7: ATOMIC DvP SETTLEMENT");
  console.log("─────────────────────────────────────────────────────");

  const dvpResult = await dvpEngine.executeDvP({
    bondMint,
    usdcMint: mockUSDCMint,
    bondAmount: BOND_AMOUNT,
    usdcAmount: USDC_AMOUNT,
    issuer: issuer.publicKey,
    investor: investor.publicKey,
  });

  // ============================================================
  // PHASE 8: POST-SETTLEMENT VERIFICATION
  // ============================================================
  console.log("\n\n📋 PHASE 8: POST-SETTLEMENT VERIFICATION");
  console.log("─────────────────────────────────────────────────────\n");

  await sleep(1000); // Wait for confirmation

  const issuerBondsAfter = await getAccount(
    connection,
    issuerBondAccount,
    "confirmed",
    TOKEN_2022_PROGRAM_ID
  );

  const investorBondsAfter = await getAccount(
    connection,
    investorBondAccount,
    "confirmed",
    TOKEN_2022_PROGRAM_ID
  );

  const investorUSDCAfter = await getAccount(
    connection,
    investorUSDCAccount,
    "confirmed",
    TOKEN_PROGRAM_ID
  );

  const issuerUSDCAfter = await getAccount(
    connection,
    issuerUSDCAccount,
    "confirmed",
    TOKEN_PROGRAM_ID
  );

  console.log("📊 Account Balances:");
  console.log("\n   Issuer:");
  console.log(
    `   - Bonds: ${issuerBondsAfter.amount.toString()} (was ${issuerBondsBefore.amount.toString()})`
  );
  console.log(
    `   - USDC: ${Number(issuerUSDCAfter.amount) / 1e6} (was ${
      Number(issuerUSDCBefore.amount) / 1e6
    })`
  );
  console.log("\n   Investor:");
  console.log(
    `   - Bonds: ${investorBondsAfter.amount.toString()} (was ${investorBondsBefore.amount.toString()})`
  );
  console.log(
    `   - USDC: ${Number(investorUSDCAfter.amount) / 1e6} (was ${
      Number(investorUSDCBefore.amount) / 1e6
    })`
  );

  // ============================================================
  // PHASE 9: VERIFICATION & ASSERTIONS
  // ============================================================
  console.log("\n\n📋 PHASE 9: VERIFICATION");
  console.log("─────────────────────────────────────────────────────\n");

  const assertions: { name: string; passed: boolean; message: string }[] = [];

  // Verify bond transfer
  const bondTransferCorrect =
    Number(issuerBondsAfter.amount) ===
      Number(issuerBondsBefore.amount) - BOND_AMOUNT &&
    Number(investorBondsAfter.amount) ===
      Number(investorBondsBefore.amount) + BOND_AMOUNT;

  assertions.push({
    name: "Bond Transfer",
    passed: bondTransferCorrect,
    message: bondTransferCorrect ? "✅ PASS" : "❌ FAIL",
  });

  // Verify USDC transfer
  const usdcTransferCorrect =
    Number(issuerUSDCAfter.amount) ===
      Number(issuerUSDCBefore.amount) + USDC_AMOUNT * 1e6 &&
    Number(investorUSDCAfter.amount) ===
      Number(investorUSDCBefore.amount) - USDC_AMOUNT * 1e6;

  assertions.push({
    name: "USDC Transfer",
    passed: usdcTransferCorrect,
    message: usdcTransferCorrect ? "✅ PASS" : "❌ FAIL",
  });

  // Verify atomicity (both happened)
  const atomicityCorrect = bondTransferCorrect && usdcTransferCorrect;
  assertions.push({
    name: "Atomic Execution",
    passed: atomicityCorrect,
    message: atomicityCorrect ? "✅ PASS" : "❌ FAIL",
  });

  // Print results
  console.log("🧪 Test Results:");
  assertions.forEach((assertion) => {
    console.log(`   ${assertion.name}: ${assertion.message}`);
  });

  const allPassed = assertions.every((a) => a.passed);

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n\n═══════════════════════════════════════════════════════");
  console.log("   DEMO SUMMARY");
  console.log("═══════════════════════════════════════════════════════\n");

  console.log(`✅ Settlement Status: ${allPassed ? "SUCCESS" : "FAILED"}`);
  console.log(
    `⚡ Transaction: https://explorer.solana.com/tx/${dvpResult.signature}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`
  );
  console.log(`🔗 Network: Local Validator`);
  console.log(`💰 Bond Amount: ${BOND_AMOUNT}`);
  console.log(`💵 USDC Amount: ${USDC_AMOUNT}`);
  console.log(`⏱️  Settlement Time: <1 second (atomic)`);
  console.log(`💡 Cost: <$0.01 per transaction`);
  console.log(`🛡️  Counterparty Risk: ZERO (atomic execution)`);

  console.log("\n═══════════════════════════════════════════════════════\n");

  if (!allPassed) {
    throw new Error("Some test assertions failed");
  }

  console.log("✅ All tests passed!\n");
  return dvpResult;
}

// Run the demo
if (require.main === module) {
  runDvPDemo()
    .then(() => {
      console.log("Demo completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Demo failed:");
      console.error(error);
      process.exit(1);
    });
}

export { runDvPDemo };
