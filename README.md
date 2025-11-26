# DvP (Delivery vs Payment) example Implementation for Solana

> ⚠️ **IMPORTANT: Educational Reference Implementation**
>
> This is a reference implementation for exploration and educational purposes only. **Do NOT use this code directly in production** without comprehensive security audits, proper key management, regulatory compliance review, and extensive modifications.

## Executive Summary

This reference implementation demonstrates an end-to-end commercial paper **Delivery vs Payment (DvP)** workflow on Solana without writing custom Rust programs, using only existing SPL Token 2022 features for bonds and standard USDC for settlement.

### The Problem

When you buy bonds (like commercial paper), traditionally two things need to happen:

1. You send money → Seller
2. Seller sends bonds → You

If these happen separately, there's risk — what if you pay but never get the bonds? Or vice versa?

### The Solution (DvP)

"Delivery vs Payment" means **both transfers happen at the exact same moment, or neither happens**. It's like a swap where both sides exchange simultaneously.

```
┌─────────────────────────────────────────────────┐
│           ONE ATOMIC TRANSACTION                │
│                                                 │
│   Investor ──── $95,000 USDC ────→ Issuer      │
│   Issuer ────── 100 Bonds ───────→ Investor    │
│                                                 │
│   ✅ Both happen together, or neither happens   │
└─────────────────────────────────────────────────┘
```

### Why No Custom Rust Programs?

On Solana, you can build this using existing tools (SPL Token 2022) instead of writing complex smart contracts from scratch. It's like building with LEGO pieces that already exist rather than manufacturing your own.

> **TL;DR:** A code demo showing how to safely trade bonds for dollars on Solana, where the swap is guaranteed to be fair — you can't get scammed because the trade is all-or-nothing.

### Key Features

✅ **Atomic Settlement** - Both legs execute or neither (no counterparty risk)  
✅ **No Custom Programs** - Uses only SPL Token 2022 extensions  
✅ **On-Chain Metadata** - Bond details stored directly on-chain  
✅ **Default Frozen State** - Bonds require explicit whitelisting for compliance  
✅ **Delegated Authority** - Settlement agent orchestrates without custody

### Performance Metrics

| Metric            | Traditional | This Implementation |
| ----------------- | ----------- | ------------------- |
| Settlement Time   | 2 days      | <1 second           |
| Cost per Trade    | $50-$500    | <$0.01              |
| Counterparty Risk | High        | Zero (atomic)       |
| Complexity        | High        | Low                 |

---

## Quick Start

### Prerequisites

1. **Node.js** (v18 or higher)
2. **Solana CLI** tools
3. **Local validator** (for testing)

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd dvp

# Install dependencies
npm install
```

### Running the Demo

#### Step 1: Start Local Validator

In a separate terminal:

```bash
solana-test-validator
```

Keep this running during the demo.

#### Step 2: Run the Demo

In your main terminal:

```bash
npm test
```

You should see output like:

```
═══════════════════════════════════════════════════════
   DvP Demo - Solana Reference Implementation
═══════════════════════════════════════════════════════

📋 PHASE 1: INITIALIZATION
─────────────────────────────────────────────────────

🔗 Connected to: http://localhost:8899

👥 Creating participants...
   Settlement Agent: <address>
   Issuer: <address>
   Investor: <address>

💰 Funding accounts with SOL...
...

✅ All tests passed!
```

---

## Architecture Overview

### Core Components

```
┌─────────────────────────────────────────────────────┐
│                    DvP Engine                       │
├─────────────────────────────────────────────────────┤
│ • Bond Token Creation (Token-2022 + Extensions)     │
│ • USDC Integration (Standard SPL Token)             │
│ • Whitelist Management (Freeze/Thaw)                │
│ • Bond token metadata management (name, symbol etc.)│
│ • Atomic DvP Execution                              │
│ • Delegation Management                             │
└─────────────────────────────────────────────────────┘
```

### Design Principles

1. **No Custom Programs**: Uses only SPL Token 2022 extensions
2. **On-Chain Metadata**: Bond details stored directly on the mint
3. **Atomic Settlement**: Single transaction for both legs
4. **Default Frozen State**: Bonds frozen by default for compliance
5. **Delegated Authority**: Settlement agent orchestrates without custody
6. **Network State**: No point-to-point API connectivity required

---

## Technical Implementation

### Bond Token (Commercial Paper)

**Structure:**

- **Default State**: FROZEN (requires whitelisting)
  - This means the token account owner can not transfer the bonds until they are whitelisted by the settlement agent.
- **Program**: SPL Token 2022
- **Extensions**: Default Account State, Metadata Pointer, Token Metadata
- **Decimals**: 0 (whole bonds only)

**On-Chain Metadata:**

- `name` - Bond name (e.g., "Commercial Paper")
- `symbol` - Bond symbol (e.g., "CP")
- `uri` - Optional URI for off-chain data
- `couponRate` - Interest rate (example, stored as additional metadata)
- `maturityDate` - Bond maturity date (example, stored as additional metadata)
- `isin` - International Securities Identification Number (example, optional)

**Authorities:**

- **Mint Authority**: Issuer (creates supply)
- **Freeze Authority**: Settlement Agent (manages whitelist)
- **Update Authority**: Settlement Agent (manages metadata)

### Settlement Currency (USDC)

**Structure:**

- Standard USDC (existing SPL Token)
- No modifications needed
- Already widely available and liquid

---

## DvP Workflow

### Phase 1: Setup

1. Create Bond Token with frozen default state and on-chain metadata
2. Configure USDC accounts
3. Set authorities (mint, freeze, update)

### Phase 2: Preparation

1. Issuer mints bonds to themselves
2. Investor acquires USDC
3. Whitelist investor (thaw bond account)
4. Both parties delegate to Settlement Agent

### Phase 3: Atomic Settlement

```
Single Transaction:
├── TransferChecked(bonds, 100) → Investor
└── TransferChecked(USDC, 95000) → Issuer
    ↓
✅ SETTLEMENT COMPLETE (atomic, <1 second)
```

**Key Benefits:**

- ⚡ Sub-second settlement
- 🛡️ Zero counterparty risk
- 💰 Ultra-low cost (<$0.01)
- 🔒 Both transfers or neither

---

## API Reference

### DvPEngine

Main class for DvP operations.

#### Constructor

```typescript
constructor(connection: Connection, settlementAgent: Keypair)
```

#### Methods

##### `createBondToken()`

Creates a bond token using Token-2022 with Default Account State, Metadata Pointer, and Token Metadata extensions. Bond details are stored on-chain.

```typescript
async createBondToken(
  issuer: Keypair,
  config: BondTokenConfig
): Promise<PublicKey>
```

**Parameters:**

- `issuer` - The issuer's keypair
- `config` - Bond configuration:
  - `name` - Bond name
  - `symbol` - Bond symbol
  - `decimals` - Token decimals (typically 0 for bonds)
  - `maturityDate` - Bond maturity date
  - `couponRate` - Interest rate
  - `isin` - Optional ISIN identifier
  - `description` - Optional URI for off-chain data

**Returns:** The mint address of the created bond token

##### `whitelist()`

Whitelists a participant by creating and thawing their bond account.

```typescript
async whitelist(
  bondMint: PublicKey,
  participant: PublicKey,
  payer: Keypair
): Promise<PublicKey>
```

**Parameters:**

- `bondMint` - The bond token mint address
- `participant` - The participant's public key (issuer or investor)
- `payer` - Keypair that pays for account creation

**Returns:** The participant's bond token account address

##### `removeFromWhitelist()`

Removes an investor from the whitelist by freezing their account.

```typescript
async removeFromWhitelist(
  bondMint: PublicKey,
  investorBondAccount: PublicKey
): Promise<void>
```

##### `delegateAuthority()`

Delegates token account authority to the settlement agent.

```typescript
async delegateAuthority(
  owner: Keypair,
  tokenAccount: PublicKey,
  amount: number,
  decimals: number,
  programId: PublicKey
): Promise<void>
```

##### `executeDvP()`

Executes atomic DvP settlement.

```typescript
async executeDvP(params: DvPParams): Promise<DvPResult>
```

**Parameters:**

```typescript
interface DvPParams {
  bondMint: PublicKey;
  usdcMint: PublicKey;
  bondAmount: number;
  usdcAmount: number;
  issuer: PublicKey;
  investor: PublicKey;
}
```

**Returns:**

```typescript
interface DvPResult {
  signature: string;
  bondAmount: number;
  usdcAmount: number;
  timestamp: Date;
  bondsSent: boolean;
  usdcReceived: boolean;
}
```

---

## Code Examples

### Basic Usage

```typescript
import { Connection, Keypair } from "@solana/web3.js";
import { DvPEngine } from "./src/dvp-engine";

// Initialize
const connection = new Connection("http://localhost:8899", "confirmed");
const settlementAgent = Keypair.generate();
const issuer = Keypair.generate();
const investor = Keypair.generate();

// Create engine
const dvp = new DvPEngine(connection, settlementAgent);

// Create bond token
const bondMint = await dvp.createBondToken(issuer, {
  name: "Commercial Paper",
  symbol: "CP",
  decimals: 0,
  maturityDate: new Date("2026-12-31"),
  couponRate: 5.0,
});

// Whitelist participants
await dvp.whitelist(bondMint, issuer.publicKey, settlementAgent);
await dvp.whitelist(bondMint, investor.publicKey, settlementAgent);

// Execute DvP
const result = await dvp.executeDvP({
  bondMint,
  usdcMint: USDC_MINT,
  bondAmount: 100,
  usdcAmount: 95000,
  issuer: issuer.publicKey,
  investor: investor.publicKey,
});

console.log(`Settlement complete: ${result.signature}`);
```

---

## Testing

### Run Tests

```bash
npm test
```

### Test Coverage

The test suite covers:

- ✅ Bond token creation with Token-2022 + Metadata
- ✅ On-chain metadata (name, symbol, couponRate, maturityDate, isin)
- ✅ Whitelist management (freeze/thaw)
- ✅ USDC account setup
- ✅ Authority delegation
- ✅ Atomic DvP execution
- ✅ Balance verification
- ✅ Atomicity validation

### Test Output

The demo provides detailed output showing:

1. Account creation and funding
2. Bond token minting
3. Whitelist operations
4. Pre-settlement balances
5. Atomic settlement execution
6. Post-settlement verification
7. Test assertions and results

---

## Why Solana Over EVM?

| Aspect           | Ethereum (EVM)                 | Solana                       |
| ---------------- | ------------------------------ | ---------------------------- |
| Settlement Logic | Complex smart contract         | Atomic transaction bundling  |
| Settlement Time  | 2-10 minutes                   | <1 second                    |
| Cost             | $0.20-100                      | <$0.01                       |
| Risk             | Smart contract vulnerabilities | Audited system programs only |
| Complexity       | High (custom contracts)        | Low (native features)        |

**Key Insight:** Solana's atomic transaction bundling is superior to smart contract complexity for DvP workflows.

---

## Production Considerations

### What This Implementation Provides

✅ Architecture demonstration using SPL Token 2022  
✅ On-chain metadata for bond details  
✅ Atomic settlement patterns  
✅ Authority separation models  
✅ Whitelist management

### What Production Requires

❌ **Security Audits** - Comprehensive third-party audits  
❌ **Key Management** - HSM/MPC for private keys  
❌ **Regulatory Compliance** - KYC/AML integration for example via [Solana Attestation Service](https://solana.com/de/news/solana-attestation-service)
❌ **Monitoring** - Real-time transaction monitoring  
❌ **Backup Systems** - Failover and disaster recovery  
❌ **Legal Review** - Compliance with securities laws

---

## Project Structure

```
dvp/
├── src/
│   ├── dvp-engine.ts      # Main DVP engine implementation
│   ├── types.ts           # TypeScript type definitions
│   └── index.ts           # Public exports
├── tests/
│   └── dvp.test.ts        # Comprehensive test suite
├── dist/                  # Compiled JavaScript (after build)
├── package.json           # Dependencies and scripts
├── tsconfig.json          # TypeScript configuration
└── README.md              # This file
```

---

## Common Issues & Troubleshooting

## Security Considerations

⚠️ **CRITICAL SECURITY NOTICES:**

1. **Private Keys**: Never commit private keys to version control
2. **Production Use**: This is a demo - requires extensive modifications for production
3. **Audits Required**: Get professional security audits before using with real value
4. **Key Management**: Use HSM, multisig (For example [Squads](https://squads.xyz/)) or MPC for production key management
5. **Regulatory**: Ensure compliance with securities regulations in your jurisdiction

---

## Why Delegation? (TradFi Pattern)

This is actually how real settlement systems work — a **Central Counterparty (CCP)** or **Clearinghouse** sits in the middle. Both parties trust the clearinghouse to execute fairly.

```
┌─────────┐     delegates      ┌──────────────────┐     delegates     ┌──────────┐
│ Issuer  │ ─────────────────→ │ Settlement Agent │ ←──────────────── │ Investor │
└─────────┘    (bonds)         │    (trusted)     │      (USDC)       └──────────┘
                               │                  │
                               │  executes atomic │
                               │   transaction    │
                               └──────────────────┘
```

### Alternative: Peer-to-Peer with Partial Signatures

On Solana you could theoretically also build this using partially signed transactions, where both parties sign the same transaction:

```typescript
// 1. Build transaction
const tx = new Transaction().add(bondTransfer, usdcTransfer);

// 2. Issuer partially signs
tx.partialSign(issuer);

// 3. Send to investor (off-chain)
const serialized = tx.serialize({ requireAllSignatures: false });

// 4. Investor adds signature
tx.partialSign(investor);

// 5. Broadcast complete transaction
await sendAndConfirmTransaction(connection, tx, []);
```

But this adds UX complexity — both parties need to be online and coordinate.

> **TL;DR:** The delegation pattern is actually production-valid. The "user signing" already happened when they called `approve()` to delegate to the settlement agent.

---

## Dependencies

- `@solana/web3.js` - Solana JavaScript SDK
- `@solana/spl-token` - SPL Token program bindings
- `@solana/spl-token-metadata` - Token Metadata extension helpers
- `typescript` - TypeScript compiler
- `ts-node` - TypeScript execution environment

---

## License

MIT License - See LICENSE file for details

---

## Contributing

This is a reference implementation. For production use cases, please:

1. Fork this repository
2. Conduct security audits
3. Implement proper key management
4. Add comprehensive error handling
5. Integrate compliance systems

---

## Resources

- [Solana Documentation](https://docs.solana.com/)
- [SPL Token 2022](https://spl.solana.com/token-2022)
- [Token Metadata Extension](https://solana.com/de/docs/tokens/extensions/metadata)
- [Solana Cookbook](https://solana.com/developers/cookbook)

---

## Contact

For questions or issues, please open a GitHub issue.

---
