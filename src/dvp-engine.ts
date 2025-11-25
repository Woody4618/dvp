import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  createAccount,
  mintTo,
  approve,
  transferChecked,
  thawAccount,
  freezeAccount,
  getAccount,
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeMintInstruction,
  createInitializeDefaultAccountStateInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeInstruction,
  createUpdateFieldInstruction,
  AccountState,
  LENGTH_SIZE,
  TYPE_SIZE,
} from "@solana/spl-token";
import { pack, type TokenMetadata } from "@solana/spl-token-metadata";
import { BondTokenConfig, DvPParams, DvPResult } from "./types";

/**
 * MPX DvP Engine - Reference Implementation
 *
 * This implementation demonstrates Delivery vs Payment (DvP) on Solana using:
 * - SPL Token 2022 with Default Account State extension for bonds
 * - Standard USDC for settlement
 * - Atomic transactions for settlement
 * - Delegated authority pattern for settlement agent
 *
 * ⚠️ IMPORTANT: This is a reference implementation for educational purposes.
 * Do NOT use in production without proper audits and security reviews.
 */
export class MPXDvPEngine {
  private connection: Connection;
  private settlementAgent: Keypair;

  constructor(connection: Connection, settlementAgent: Keypair) {
    this.connection = connection;
    this.settlementAgent = settlementAgent;
  }

  /**
   * Creates a bond token using Token-2022 with Default Account State and Metadata extensions
   * Bonds are frozen by default and require whitelisting
   * Metadata is stored on-chain using the TokenMetadata extension
   */
  async createBondToken(
    issuer: Keypair,
    config: BondTokenConfig
  ): Promise<PublicKey> {
    console.log("\n🏗️  Creating bond token with Token-2022 + Metadata...");
    console.log(`   Name: ${config.name}`);
    console.log(`   Symbol: ${config.symbol}`);
    console.log(`   Coupon Rate: ${config.couponRate}%`);
    console.log(
      `   Maturity: ${config.maturityDate.toISOString().split("T")[0]}`
    );

    // Generate new keypair for the mint
    const mintKeypair = Keypair.generate();

    // Create the metadata object to get EXACT size
    const metadata: TokenMetadata = {
      mint: mintKeypair.publicKey,
      name: config.name,
      symbol: config.symbol,
      uri: config.description || "",
      additionalMetadata: [
        // Commented out for now - can add back after basic metadata works
        ["couponRate", config.couponRate.toString()],
        ["maturityDate", config.maturityDate.toISOString()],
        ["isin", config.isin || ""],
      ],
    };

    // Size of metadata using pack() - this gives us the EXACT size
    const metadataLen = pack(metadata).length;

    // Size of MetadataExtension: 2 bytes for type, 2 bytes for length
    const metadataExtension = TYPE_SIZE + LENGTH_SIZE;

    // Calculate space for mint with extensions (without metadata)
    const extensions = [
      ExtensionType.DefaultAccountState,
      ExtensionType.MetadataPointer,
    ];
    const spaceWithoutMetadataExtension = getMintLen(extensions);

    // Calculate rent for FULL space (mint + metadata + TLV overhead)
    var lamports = await this.connection.getMinimumBalanceForRentExemption(
      spaceWithoutMetadataExtension + metadataLen + metadataExtension
    );
    lamports += 100000000;

    // Build transaction following the official docs pattern
    const transaction = new Transaction().add(
      // 1. Create account with just base space, but rent for full space
      SystemProgram.createAccount({
        fromPubkey: issuer.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: spaceWithoutMetadataExtension, // Just base space
        lamports, // But rent for full space (includes metadata + TLV)
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      // 2. Initialize metadata pointer (before mint!)
      createInitializeMetadataPointerInstruction(
        mintKeypair.publicKey,
        issuer.publicKey, // authority
        mintKeypair.publicKey, // metadata address (self)
        TOKEN_2022_PROGRAM_ID
      ),
      // 3. Initialize default account state (frozen)
      createInitializeDefaultAccountStateInstruction(
        mintKeypair.publicKey,
        AccountState.Frozen,
        TOKEN_2022_PROGRAM_ID
      ),
      // 4. Initialize mint
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        config.decimals,
        issuer.publicKey, // mint authority
        this.settlementAgent.publicKey, // freeze authority
        TOKEN_2022_PROGRAM_ID
      ),
      // 5. Initialize metadata
      createInitializeInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        mint: mintKeypair.publicKey,
        metadata: mintKeypair.publicKey,
        name: config.name,
        symbol: config.symbol,
        uri: config.description || "",
        mintAuthority: issuer.publicKey,
        updateAuthority: issuer.publicKey,
      })
    );

    // 6. Add custom metadata fields from additionalMetadata array
    for (const [field, value] of metadata.additionalMetadata) {
      if (value) {
        transaction.add(
          createUpdateFieldInstruction({
            programId: TOKEN_2022_PROGRAM_ID,
            metadata: mintKeypair.publicKey,
            updateAuthority: issuer.publicKey,
            field: field,
            value: value,
          })
        );
      }
    }

    // Send transaction
    await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [issuer, mintKeypair],
      { commitment: "confirmed" }
    );

    console.log(`✅ Bond token created: ${mintKeypair.publicKey.toBase58()}`);
    console.log(`   Mint Authority: ${issuer.publicKey.toBase58()}`);
    console.log(
      `   Freeze Authority: ${this.settlementAgent.publicKey.toBase58()}`
    );
    console.log(`   Default State: FROZEN (requires whitelisting)`);
    console.log(`   ✨ Metadata: ON-CHAIN`);
    console.log(`   - Name: ${config.name}`);
    console.log(`   - Symbol: ${config.symbol}`);
    console.log(`   - URI: ${config.description || "N/A"}`);
    console.log(
      `   📝 Bond Details: ${config.couponRate}% coupon, matures ${
        config.maturityDate.toISOString().split("T")[0]
      }`
    );

    return mintKeypair.publicKey;
  }

  /**
   * Whitelists an investor by creating their bond account and thawing it
   */
  async whitelistInvestor(
    bondMint: PublicKey,
    investor: PublicKey,
    payer: Keypair
  ): Promise<PublicKey> {
    console.log(`\n🔓 Whitelisting investor: ${investor.toBase58()}`);

    // Create token account (will be frozen by default)
    const investorBondAccount = await createAccount(
      this.connection,
      payer,
      bondMint,
      investor,
      undefined,
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );

    console.log(`   Account created: ${investorBondAccount.toBase58()}`);

    // Thaw the account to allow trading
    await thawAccount(
      this.connection,
      this.settlementAgent,
      investorBondAccount,
      bondMint,
      this.settlementAgent,
      [],
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );

    console.log(`✅ Investor whitelisted and account thawed`);

    return investorBondAccount;
  }

  /**
   * Removes an investor from whitelist by freezing their account
   */
  async removeFromWhitelist(
    bondMint: PublicKey,
    investorBondAccount: PublicKey
  ): Promise<void> {
    console.log(
      `\n🔒 Removing from whitelist: ${investorBondAccount.toBase58()}`
    );

    await freezeAccount(
      this.connection,
      this.settlementAgent,
      investorBondAccount,
      bondMint,
      this.settlementAgent,
      [],
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );

    console.log(`✅ Account frozen and removed from whitelist`);
  }

  /**
   * Delegates authority to settlement agent for a token account
   */
  async delegateAuthority(
    owner: Keypair,
    tokenAccount: PublicKey,
    amount: number,
    decimals: number,
    programId: PublicKey
  ): Promise<void> {
    const amountWithDecimals = amount * Math.pow(10, decimals);

    console.log(`\n🤝 Delegating authority...`);
    console.log(`   Account: ${tokenAccount.toBase58()}`);
    console.log(`   Amount: ${amount}`);
    console.log(`   Delegate: ${this.settlementAgent.publicKey.toBase58()}`);

    await approve(
      this.connection,
      owner,
      tokenAccount,
      this.settlementAgent.publicKey,
      owner.publicKey,
      amountWithDecimals,
      [],
      { commitment: "confirmed" },
      programId
    );

    console.log(`✅ Authority delegated`);
  }

  /**
   * Executes atomic DvP settlement
   * Both bond and USDC transfers happen in a single transaction
   */
  async executeDvP(params: DvPParams): Promise<DvPResult> {
    console.log(`\n⚡ Executing atomic DvP settlement...`);
    console.log(`   Bonds: ${params.bondAmount}`);
    console.log(`   USDC: ${params.usdcAmount}`);
    console.log(`   Issuer: ${params.issuer.toBase58()}`);
    console.log(`   Investor: ${params.investor.toBase58()}`);

    // Get all associated token account addresses (deterministically, no network calls)
    const issuerBondAccount = await getAssociatedTokenAddress(
      params.bondMint,
      params.issuer,
      false, // allowOwnerOffCurve
      TOKEN_2022_PROGRAM_ID
    );

    const investorBondAccount = await getAssociatedTokenAddress(
      params.bondMint,
      params.investor,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const investorUSDCAccount = await getAssociatedTokenAddress(
      params.usdcMint,
      params.investor,
      false,
      TOKEN_PROGRAM_ID
    );

    const issuerUSDCAccount = await getAssociatedTokenAddress(
      params.usdcMint,
      params.issuer,
      false,
      TOKEN_PROGRAM_ID
    );

    // Build atomic transaction
    const transaction = new Transaction();

    // Add bond transfer instruction (Issuer → Investor)
    transaction.add(
      await this.createTransferCheckedInstruction(
        issuerBondAccount,
        params.bondMint,
        investorBondAccount,
        params.issuer,
        params.bondAmount,
        0, // bonds have 0 decimals
        TOKEN_2022_PROGRAM_ID
      )
    );

    // Add USDC transfer instruction (Investor → Issuer)
    transaction.add(
      await this.createTransferCheckedInstruction(
        investorUSDCAccount,
        params.usdcMint,
        issuerUSDCAccount,
        params.investor,
        params.usdcAmount * 1e6, // USDC has 6 decimals
        6,
        TOKEN_PROGRAM_ID
      )
    );

    // Send atomic transaction
    console.log(`\n📡 Sending atomic transaction...`);
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.settlementAgent],
      { commitment: "confirmed" }
    );

    console.log(`✅ DvP SETTLED ATOMICALLY`);
    console.log(`   Signature: ${signature}`);
    console.log(`   Bonds transferred: ${params.bondAmount}`);
    console.log(`   USDC transferred: ${params.usdcAmount}`);

    return {
      signature,
      bondAmount: params.bondAmount,
      usdcAmount: params.usdcAmount,
      timestamp: new Date(),
      bondsSent: true,
      usdcReceived: true,
    };
  }

  /**
   * Helper to create a transferChecked instruction with delegation
   */
  private async createTransferCheckedInstruction(
    source: PublicKey,
    mint: PublicKey,
    destination: PublicKey,
    owner: PublicKey,
    amount: number,
    decimals: number,
    programId: PublicKey
  ) {
    const { TOKEN_PROGRAM_ID: TOKEN_ID, createTransferCheckedInstruction } =
      await import("@solana/spl-token");

    return createTransferCheckedInstruction(
      source,
      mint,
      destination,
      this.settlementAgent.publicKey, // Use settlement agent as authority (delegated)
      amount,
      decimals,
      [],
      programId
    );
  }

  /**
   * Gets account information for inspection
   */
  async getAccountInfo(tokenAccount: PublicKey, programId: PublicKey) {
    const account = await getAccount(
      this.connection,
      tokenAccount,
      "confirmed",
      programId
    );

    return {
      address: tokenAccount,
      mint: account.mint,
      owner: account.owner,
      amount: account.amount,
      isFrozen: account.isFrozen,
    };
  }

  /**
   * Airdrops SOL for testing (devnet/testnet only)
   */
  async airdropSol(publicKey: PublicKey, amount: number): Promise<void> {
    console.log(`\n💰 Airdropping ${amount} SOL to ${publicKey.toBase58()}`);
    const signature = await this.connection.requestAirdrop(
      publicKey,
      amount * LAMPORTS_PER_SOL
    );
    await this.connection.confirmTransaction(signature, "confirmed");
    console.log(`✅ Airdrop complete`);
  }
}
