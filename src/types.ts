import { PublicKey } from '@solana/web3.js';

/**
 * Configuration for creating a bond token
 */
export interface BondTokenConfig {
  name: string;
  symbol: string;
  decimals: number;
  maturityDate: Date;
  couponRate: number;
  isin?: string;
  description?: string;
}

/**
 * Parameters for executing a DvP transaction
 */
export interface DvPParams {
  bondMint: PublicKey;
  usdcMint: PublicKey;
  bondAmount: number;
  usdcAmount: number;
  issuer: PublicKey;
  investor: PublicKey;
}

/**
 * Result of a DvP transaction
 */
export interface DvPResult {
  signature: string;
  bondAmount: number;
  usdcAmount: number;
  timestamp: Date;
  bondsSent: boolean;
  usdcReceived: boolean;
}

/**
 * Account information for tracking
 */
export interface AccountInfo {
  address: PublicKey;
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  isFrozen: boolean;
}

