import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createMint,
  createAccount,
  mintTo,
  approve,
  transferChecked,
  thawAccount,
  freezeAccount,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeMintInstruction,
  createInitializeDefaultAccountStateInstruction,
  AccountState,
} from '@solana/spl-token';
import { BondTokenConfig, DvPParams, DvPResult } from './types';

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
   * Creates a bond token using Token-2022 with Default Account State extension
   * Bonds are frozen by default and require whitelisting
   */
  async createBondToken(
    issuer: Keypair,
    config: BondTokenConfig
  ): Promise<PublicKey> {
    console.log('\n🏗️  Creating bond token with Token-2022...');
    console.log(`   Name: ${config.name}`);
    console.log(`   Symbol: ${config.symbol}`);
    console.log(`   Coupon Rate: ${config.couponRate}%`);
    console.log(`   Maturity: ${config.maturityDate.toISOString().split('T')[0]}`);

    // Generate new keypair for the mint
    const mintKeypair = Keypair.generate();

    // Calculate space required for mint with extensions
    const extensions = [ExtensionType.DefaultAccountState];
    const mintLen = getMintLen(extensions);

    // Calculate minimum lamports for rent exemption
    const lamports = await this.connection.getMinimumBalanceForRentExemption(mintLen);

    // Build transaction with all required instructions
    const transaction = new Transaction().add(
      // Create account
      SystemProgram.createAccount({
        fromPubkey: issuer.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      // Initialize default account state (frozen)
      createInitializeDefaultAccountStateInstruction(
        mintKeypair.publicKey,
        AccountState.Frozen,
        TOKEN_2022_PROGRAM_ID
      ),
      // Initialize mint
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        config.decimals,
        issuer.publicKey, // mint authority
        this.settlementAgent.publicKey, // freeze authority
        TOKEN_2022_PROGRAM_ID
      )
    );

    // Send transaction
    await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [issuer, mintKeypair],
      { commitment: 'confirmed' }
    );

    console.log(`✅ Bond token created: ${mintKeypair.publicKey.toBase58()}`);
    console.log(`   Mint Authority: ${issuer.publicKey.toBase58()}`);
    console.log(`   Freeze Authority: ${this.settlementAgent.publicKey.toBase58()}`);
    console.log(`   Default State: FROZEN (requires whitelisting)`);

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
      { commitment: 'confirmed' },
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
      { commitment: 'confirmed' },
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
    console.log(`\n🔒 Removing from whitelist: ${investorBondAccount.toBase58()}`);

    await freezeAccount(
      this.connection,
      this.settlementAgent,
      investorBondAccount,
      bondMint,
      this.settlementAgent,
      [],
      { commitment: 'confirmed' },
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
      { commitment: 'confirmed' },
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

    // Get all token accounts
    const issuerBondAccount = await this.findTokenAccount(
      params.bondMint,
      params.issuer,
      TOKEN_2022_PROGRAM_ID
    );

    const investorBondAccount = await this.findTokenAccount(
      params.bondMint,
      params.investor,
      TOKEN_2022_PROGRAM_ID
    );

    const investorUSDCAccount = await this.findTokenAccount(
      params.usdcMint,
      params.investor,
      TOKEN_PROGRAM_ID
    );

    const issuerUSDCAccount = await this.findTokenAccount(
      params.usdcMint,
      params.issuer,
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
      { commitment: 'confirmed' }
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
   * Helper to find a token account for a given mint and owner
   */
  private async findTokenAccount(
    mint: PublicKey,
    owner: PublicKey,
    programId: PublicKey
  ): Promise<PublicKey> {
    const accounts = await this.connection.getTokenAccountsByOwner(
      owner,
      { mint, programId },
      'confirmed'
    );

    if (accounts.value.length === 0) {
      throw new Error(`No token account found for mint ${mint.toBase58()} and owner ${owner.toBase58()}`);
    }

    return accounts.value[0].pubkey;
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
    const { TOKEN_PROGRAM_ID: TOKEN_ID, createTransferCheckedInstruction } = await import('@solana/spl-token');
    
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
      'confirmed',
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
    await this.connection.confirmTransaction(signature, 'confirmed');
    console.log(`✅ Airdrop complete`);
  }
}

