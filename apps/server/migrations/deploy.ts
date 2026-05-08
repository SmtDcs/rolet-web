// Bootstrap script — runs once after `anchor deploy`.
//
// Creates a localnet/devnet test SPL mint ("$ROLET"), opens the vault PDA's
// associated token account, calls `init_vault`, and seeds the treasury with
// reward tokens so the very first `settle_match` has something to pay out.
//
// Usage:
//   anchor migrate --provider.cluster localnet
//   (or invoke directly with ts-node / tsx after a deploy)
//
// Idempotent: if the vault PDA already exists, it logs and exits 0.

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const VAULT_SEED = Buffer.from("vault");
const REWARD_DECIMALS = 6;
const BASE_REWARD = new BN(10).pow(new BN(REWARD_DECIMALS)); // 1.0 token per win
const INITIAL_TREASURY_FUND = new BN(1_000).mul(BASE_REWARD); // 1,000 wins worth

module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);

  const program = anchor.workspace.Rolet as Program;
  const payer = (provider.wallet as anchor.Wallet).payer as Keypair;

  console.log("─── ROLET vault bootstrap ───");
  console.log("payer  :", payer.publicKey.toBase58());
  console.log("program:", program.programId.toBase58());

  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [VAULT_SEED],
    program.programId,
  );

  // Idempotency check
  const existing = await provider.connection.getAccountInfo(vaultPda);
  if (existing) {
    console.log("✓ vault already initialised at", vaultPda.toBase58());
    return;
  }

  // ── 1. Create / load the reward mint ──
  const mintCachePath = path.resolve(__dirname, ".reward-mint.json");
  let rewardMint: PublicKey;
  if (fs.existsSync(mintCachePath)) {
    rewardMint = new PublicKey(JSON.parse(fs.readFileSync(mintCachePath, "utf8")).mint);
    console.log("✓ reusing cached reward mint:", rewardMint.toBase58());
  } else {
    rewardMint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,    // mint authority
      payer.publicKey,    // freeze authority (revoke later if you want)
      REWARD_DECIMALS,
    );
    fs.writeFileSync(mintCachePath, JSON.stringify({ mint: rewardMint.toBase58() }, null, 2));
    console.log("✓ created reward mint:", rewardMint.toBase58());
  }

  // ── 2. Derive treasury ATA (PDA-owned) ──
  const treasuryAta = getAssociatedTokenAddressSync(
    rewardMint,
    vaultPda,
    true, // allowOwnerOffCurve — vault is a PDA
  );
  console.log("treasury ATA:", treasuryAta.toBase58());

  // ── 3. Call init_vault ──
  const sig = await program.methods
    .initVault(BASE_REWARD)
    .accounts({
      vault: vaultPda,
      rewardMint,
      treasuryAta,
      authority: payer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as never)
    .rpc({ commitment: "confirmed" });
  console.log("✓ init_vault sent:", sig);

  // ── 4. Seed the treasury with reward tokens ──
  await mintTo(
    provider.connection,
    payer,
    rewardMint,
    treasuryAta,
    payer,
    BigInt(INITIAL_TREASURY_FUND.toString()),
  );
  const treasury = await getAccount(provider.connection, treasuryAta);
  console.log(
    `✓ treasury funded · balance = ${Number(treasury.amount) / 10 ** REWARD_DECIMALS} $ROLET`,
  );

  console.log("─── done · vault bump =", vaultBump, "───");
};
