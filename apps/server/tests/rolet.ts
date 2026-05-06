import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Rolet } from "../target/types/rolet";
import { Keypair, PublicKey, SYSVAR_SLOT_HASHES_PUBKEY, SystemProgram } from "@solana/web3.js";
import { keccak_256 } from "@noble/hashes/sha3";
import { randomBytes } from "crypto";
import { assert } from "chai";

describe("rolet", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Rolet as Program<Rolet>;

  const playerOne = Keypair.generate();
  const playerTwo = Keypair.generate();
  const matchId = new BN(Date.now());

  const matchPda = PublicKey.findProgramAddressSync(
    [Buffer.from("match"), matchId.toArrayLike(Buffer, "le", 8)],
    program.programId,
  )[0];

  before(async () => {
    for (const kp of [playerOne, playerTwo]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 2e9);
      await provider.connection.confirmTransaction(sig, "confirmed");
    }
  });

  it("init_match — seeds the gun and deals two hands", async () => {
    const s1 = randomBytes(32);
    const s2 = randomBytes(32);
    const c1 = Buffer.from(keccak_256(s1));
    const c2 = Buffer.from(keccak_256(s2));

    await program.methods
      .initMatch(
        matchId,
        Array.from(c1),
        Array.from(c2),
        Array.from(s1),
        Array.from(s2),
      )
      .accounts({
        matchState: matchPda,
        playerOne: playerOne.publicKey,
        playerTwo: playerTwo.publicKey,
        payer: provider.wallet.publicKey,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const m = await program.account.matchState.fetch(matchPda);
    assert.equal(m.playerOneHp, 4);
    assert.equal(m.playerTwoHp, 4);
    assert.equal(m.gun.chambers.length, 8);
    const live = m.gun.chambers.filter((c: any) => c.live).length;
    const blank = m.gun.chambers.filter((c: any) => c.blank).length;
    assert.equal(live, 5);
    assert.equal(blank, 3);
  });
});
