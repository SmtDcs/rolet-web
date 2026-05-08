/**
 * Standalone vault bootstrap — runs without `anchor migrate` so it doesn't
 * depend on `anchor.workspace` autoloading. Loads the hand-written IDL,
 * creates a fresh SPL mint, calls init_vault, and seeds the treasury.
 *
 * Usage:
 *   npx tsx scripts/bootstrap-vault.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Connection,
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
import * as os from "os";
import * as path from "path";

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8899";
const VAULT_SEED = Buffer.from("vault");
const REWARD_DECIMALS = 6;
const BASE_REWARD = new BN(10).pow(new BN(REWARD_DECIMALS));
const INITIAL_TREASURY_FUND = new BN(1_000).mul(BASE_REWARD);

async function main() {
  const idlPath = path.resolve(__dirname, "..", "target", "idl", "rolet.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const programId = new PublicKey(idl.address);

  const walletPath =
    process.env.ANCHOR_WALLET ||
    path.join(os.homedir(), ".config", "solana", "id.json");
  const secret = JSON.parse(fs.readFileSync(walletPath, "utf8")) as number[];
  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));

  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const program = new Program(idl as any, provider);

  console.log("─── ROLET vault bootstrap ───");
  console.log("rpc    :", RPC_URL);
  console.log("payer  :", payer.publicKey.toBase58());
  console.log("program:", programId.toBase58());

  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [VAULT_SEED],
    programId,
  );

  const existing = await connection.getAccountInfo(vaultPda);
  if (existing) {
    console.log("✓ vault already initialised at", vaultPda.toBase58());
    return;
  }

  // Create / load mint
  const mintCachePath = path.resolve(__dirname, "..", "migrations", ".reward-mint.json");
  let rewardMint: PublicKey;
  if (fs.existsSync(mintCachePath)) {
    rewardMint = new PublicKey(
      JSON.parse(fs.readFileSync(mintCachePath, "utf8")).mint,
    );
    console.log("✓ reusing cached reward mint:", rewardMint.toBase58());
  } else {
    rewardMint = await createMint(
      connection,
      payer,
      payer.publicKey,
      payer.publicKey,
      REWARD_DECIMALS,
    );
    fs.writeFileSync(
      mintCachePath,
      JSON.stringify({ mint: rewardMint.toBase58() }, null, 2),
    );
    console.log("✓ created reward mint:", rewardMint.toBase58());
  }

  const treasuryAta = getAssociatedTokenAddressSync(
    rewardMint,
    vaultPda,
    true,
  );
  console.log("treasury ATA:", treasuryAta.toBase58());

  const sig = await program.methods
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .initVault(BASE_REWARD as any)
    .accounts({
      vault: vaultPda,
      rewardMint,
      treasuryAta,
      authority: payer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .rpc({ commitment: "confirmed" });
  console.log("✓ init_vault sent:", sig);

  await mintTo(
    connection,
    payer,
    rewardMint,
    treasuryAta,
    payer,
    BigInt(INITIAL_TREASURY_FUND.toString()),
  );
  const treasury = await getAccount(connection, treasuryAta);
  console.log(
    `✓ treasury funded · balance = ${
      Number(treasury.amount) / 10 ** REWARD_DECIMALS
    } $ROLET`,
  );

  console.log("─── done · vault bump =", vaultBump, "───");
}

main().catch((err) => {
  console.error("bootstrap failed:", err);
  process.exit(1);
});
