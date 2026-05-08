"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
  Keypair,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createDelegateInstruction,
  createCommitAndUndelegateInstruction,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { keccak_256 } from "@noble/hashes/sha3.js";
import bs58 from "bs58";

import idl from "@/idl/rolet.json";
import type { Rolet } from "@/idl/rolet_types";

// ============================================================
// Constants
// ============================================================
const ROLET_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_ROLET_PROGRAM_ID ??
    (idl as { address: string }).address
);

const ER_ENDPOINT =
  process.env.NEXT_PUBLIC_MAGICBLOCK_ER_ENDPOINT ??
  "https://devnet.magicblock.app";

const MATCH_SEED = Buffer.from("match");
const PROFILE_SEED = Buffer.from("profile");
const VAULT_SEED = Buffer.from("vault");
const LOBBY_SEED = Buffer.from("lobby");

// ============================================================
// Types — mirror the on-chain Card enum (camelCase per Anchor 0.30 IDL)
// ============================================================
export type RoletCard =
  | "restoreBullet"
  | "hawkEye"
  | "silence"
  | "blocker"
  | "bulletExtractor"
  | "shuffler"
  | "doubleStrike"
  | "healer"
  | "cardThief"
  | "randomInsight"
  | "lastChance"
  | "handOfFate";

const cardArg = (c: RoletCard) => ({ [c]: {} } as Record<string, object>);

export type Toast = {
  id: number;
  level: "success" | "error" | "info";
  message: string;
};

type CommitReveal = {
  secret: Uint8Array;
  commit: Uint8Array;
};

// ============================================================
// Mock toast bus
// ============================================================
let toastSeq = 0;
const toastListeners = new Set<(t: Toast) => void>();
export function emitToast(level: Toast["level"], message: string) {
  const t: Toast = { id: ++toastSeq, level, message };
  toastListeners.forEach((l) => l(t));
  if (typeof window !== "undefined") {
    // eslint-disable-next-line no-console
    console.log(`[rolet:${level}] ${message}`);
  }
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const cb = (t: Toast) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(
        () => setToasts((prev) => prev.filter((x) => x.id !== t.id)),
        4000
      );
    };
    toastListeners.add(cb);
    return () => {
      toastListeners.delete(cb);
    };
  }, []);
  return toasts;
}

// ============================================================
// Session-key helpers (MagicBlock gasless turns)
// ============================================================
type SessionKeyState = {
  keypair: Keypair;
  expiresAt: number;
};

function loadSessionKey(walletKey: string): SessionKeyState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(`rolet:session:${walletKey}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { secret: number[]; expiresAt: number };
    if (parsed.expiresAt * 1000 < Date.now()) return null;
    return {
      keypair: Keypair.fromSecretKey(Uint8Array.from(parsed.secret)),
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function persistSessionKey(walletKey: string, sk: SessionKeyState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    `rolet:session:${walletKey}`,
    JSON.stringify({
      secret: Array.from(sk.keypair.secretKey),
      expiresAt: sk.expiresAt,
    })
  );
}

// ============================================================
// PDA helpers
// ============================================================
function matchPda(matchId: BN) {
  return PublicKey.findProgramAddressSync(
    [MATCH_SEED, matchId.toArrayLike(Buffer, "le", 8)],
    ROLET_PROGRAM_ID
  )[0];
}

function profilePda(authority: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [PROFILE_SEED, authority.toBuffer()],
    ROLET_PROGRAM_ID
  )[0];
}

function vaultPda() {
  return PublicKey.findProgramAddressSync([VAULT_SEED], ROLET_PROGRAM_ID)[0];
}

function lobbyPda(matchId: BN) {
  return PublicKey.findProgramAddressSync(
    [LOBBY_SEED, matchId.toArrayLike(Buffer, "le", 8)],
    ROLET_PROGRAM_ID
  )[0];
}

// ============================================================
// Commit-Reveal generator
// ============================================================
function generateCommitReveal(): CommitReveal {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  const commit = keccak_256(secret);
  return { secret, commit };
}

function stashSecret(matchId: string, secret: Uint8Array) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    `rolet:secret:${matchId}`,
    Buffer.from(secret).toString("hex")
  );
}

function recallSecret(matchId: string): Uint8Array | null {
  if (typeof window === "undefined") return null;
  const hex = window.sessionStorage.getItem(`rolet:secret:${matchId}`);
  return hex ? Uint8Array.from(Buffer.from(hex, "hex")) : null;
}

// ============================================================
// useRolet — main integration hook
// ============================================================
export function useRolet({ ephemeral = false }: { ephemeral?: boolean } = {}) {
  const { connection: l1Connection } = useConnection();
  const wallet = useWallet();

  const [busy, setBusy] = useState(false);
  const [sessionKey, setSessionKey] = useState<SessionKeyState | null>(null);

  const erConnection = useMemo(
    () =>
      ephemeral
        ? new Connection(ER_ENDPOINT, { commitment: "processed" })
        : null,
    [ephemeral]
  );

  const connection = ephemeral && erConnection ? erConnection : l1Connection;

  useEffect(() => {
    if (!wallet.publicKey) {
      setSessionKey(null);
      return;
    }
    const cached = loadSessionKey(wallet.publicKey.toBase58());
    if (cached) setSessionKey(cached);
  }, [wallet.publicKey]);

  /**
   * Build two Program instances:
   *  - programL1: always points at the base layer (devnet / localnet). Used
   *    for every instruction that touches an account NOT delegated to the ER
   *    (PlayerProfile, GameVault, MatchState before delegate, settle_match).
   *  - programER: points at the MagicBlock ER endpoint when ephemeral mode
   *    is on. Only play_card / pull_trigger use it (after delegate).
   *
   * Untyped Program because hand-rolled IDL's literal types don't satisfy
   * the Idl constraint at compile time.
   */
  const buildProgram = useCallback(
    (conn: Connection, fast: boolean): Program | null => {
      if (
        !wallet.publicKey ||
        !wallet.signTransaction ||
        !wallet.signAllTransactions
      ) {
        return null;
      }
      const provider = new AnchorProvider(
        conn,
        {
          publicKey: wallet.publicKey,
          signTransaction: wallet.signTransaction,
          signAllTransactions: wallet.signAllTransactions,
        },
        {
          commitment: fast ? "processed" : "confirmed",
          skipPreflight: fast,
        }
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new Program(idl as any, provider);
    },
    [wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions]
  );

  const programL1 = useMemo(
    () => buildProgram(l1Connection, false),
    [buildProgram, l1Connection]
  );

  const programER = useMemo(
    () => (ephemeral && erConnection ? buildProgram(erConnection, true) : null),
    [buildProgram, ephemeral, erConnection]
  );

  // Backwards-compat: existing call sites read `program`. Default to L1.
  const program = programL1;

  const sendWithSessionKey = useCallback(
    async (tx: Transaction): Promise<string> => {
      if (!sessionKey) throw new Error("No active session key");
      // CRITICAL: always send to L1 until ER delegation actually works.
      // Routing through erConnection while the match is NOT delegated causes
      // the ER endpoint to fake-confirm the tx without writing to the L1
      // PDA — silently dropped state changes.
      const conn = l1Connection;
      tx.feePayer = sessionKey.keypair.publicKey;
      const { blockhash } = await conn.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.sign(sessionKey.keypair);
      const sig = await conn.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 2,
      });
      await conn.confirmTransaction(sig, "confirmed");
      return sig;
    },
    [l1Connection, sessionKey]
  );

  /**
   * Arms a gasless session: generates a local keypair, registers it on-chain
   * via `register_session_key` (single Phantom popup), then airdrops it a
   * small amount of SOL so it can pay tx fees inside the ER.
   */
  const startSession = useCallback(
    async (durationSeconds = 60 * 60) => {
      if (!program || !wallet.publicKey) {
        throw new Error("Connect wallet first");
      }
      setBusy(true);
      try {
        const kp = Keypair.generate();

        // 1. On-chain registration — single popup
        const regSig = await program.methods
          .registerSessionKey(kp.publicKey, new BN(durationSeconds))
          .accounts({
            profile: profilePda(wallet.publicKey),
            authority: wallet.publicKey,
          } as never)
          .rpc({ commitment: "confirmed" });
        emitToast("success", `Session registered · ${regSig.slice(0, 6)}…`);

        // 2. Fund the session keypair so it can sign ER/L1 txs without
        //    re-prompting Phantom every time. ~0.005 SOL is enough for many
        //    turns; ER fees are ~zero, this is mostly insurance.
        try {
          const transfer = SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: kp.publicKey,
            lamports: 0.005 * LAMPORTS_PER_SOL,
          });
          const fundTx = new Transaction().add(transfer);
          fundTx.feePayer = wallet.publicKey;
          fundTx.recentBlockhash = (
            await l1Connection.getLatestBlockhash()
          ).blockhash;
          if (wallet.signTransaction) {
            const signed = await wallet.signTransaction(fundTx);
            await l1Connection.sendRawTransaction(signed.serialize());
          }
        } catch {
          // Funding is best-effort; on devnet you may already have airdropped
          // SOL or the wallet may decline.
          emitToast("info", "Session funding skipped — you may need to airdrop");
        }

        const state: SessionKeyState = {
          keypair: kp,
          expiresAt: Math.floor(Date.now() / 1000) + durationSeconds,
        };
        setSessionKey(state);
        persistSessionKey(wallet.publicKey.toBase58(), state);
        emitToast("info", "Session key armed · turns are now popup-free");
        return state.keypair.publicKey;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitToast("error", `start_session failed · ${msg}`);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [program, wallet, l1Connection]
  );

  /**
   * Push a freshly-init'd MatchState into the MagicBlock ER. Sends a
   * standalone L1 tx via the @magicblock-labs/ephemeral-rollups-sdk that
   * transfers ownership of the PDA to the delegation program. After this
   * succeeds, all reads/writes against the PDA happen via the ER endpoint.
   *
   * Gracefully no-ops on localnet (delegation program isn't deployed there).
   */
  const delegateMatch = useCallback(
    async (_matchId: BN) => {
      // ER delegation permanently disabled — MagicBlock SDK has a Rust-side
      // dep conflict with Anchor 0.30.1 (§14). Attempting the delegation ix
      // causes Solflare to reject with "Network mismatch" because the
      // MagicBlock program ID is unrecognised on devnet. Match runs on L1.
      return null;
    },
    []
  );

  /**
   * Setup a ghost opponent: transfer enough SOL for ~10 turns + init their
   * PlayerProfile in a single user-signed transaction. The ghost's signature
   * is added locally; only the user pops Phantom once.
   */
  const setupGhost = useCallback(
    async (ghost: Keypair, sns: string = "ghost.dev") => {
      if (!programL1 || !wallet.publicKey || !wallet.signTransaction) {
        emitToast("error", "Wallet not connected");
        return null;
      }
      try {
        const fundIx = SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: ghost.publicKey,
          lamports: 0.02 * LAMPORTS_PER_SOL,
        });
        const initProfileIx = await programL1.methods
          .initPlayerProfile(sns, SystemProgram.programId, 10)
          .accounts({
            profile: profilePda(ghost.publicKey),
            authority: ghost.publicKey,
            systemProgram: SystemProgram.programId,
          } as never)
          .instruction();
        const tx = new Transaction().add(fundIx).add(initProfileIx);
        tx.feePayer = wallet.publicKey;
        tx.recentBlockhash = (await l1Connection.getLatestBlockhash()).blockhash;
        const userSigned = await wallet.signTransaction(tx);
        userSigned.partialSign(ghost);
        const sig = await l1Connection.sendRawTransaction(userSigned.serialize());
        await l1Connection.confirmTransaction(sig, "confirmed");
        emitToast("success", `Ghost armed · ${sig.slice(0, 6)}…`);
        return sig;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitToast("error", `setupGhost failed · ${msg}`);
        return null;
      }
    },
    [programL1, wallet, l1Connection]
  );

  /**
   * Auto-play a turn as the ghost (used when matchmaking is mocked). Picks
   * a target — defaults to OPPONENT (the human player) — and pulls the
   * trigger signed by the ghost's keypair. Bypasses session keys entirely.
   */
  const ghostPullTrigger = useCallback(
    async (matchId: BN, ghost: Keypair, targetSelf: boolean) => {
      if (!programL1) return null;
      try {
        const ix = await programL1.methods
          .pullTrigger(targetSelf)
          .accounts({
            matchState: matchPda(matchId),
            currentProfile: profilePda(ghost.publicKey),
            actor: ghost.publicKey,
          } as never)
          .instruction();
        const tx = new Transaction().add(ix);
        tx.feePayer = ghost.publicKey;
        tx.recentBlockhash = (await l1Connection.getLatestBlockhash()).blockhash;
        tx.sign(ghost);
        const sig = await l1Connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
        });
        await l1Connection.confirmTransaction(sig, "confirmed");
        emitToast(
          "info",
          `👻 Ghost fired → ${targetSelf ? "SELF" : "YOU"} · ${sig.slice(0, 6)}…`,
        );
        return sig;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitToast("error", `ghost turn failed · ${msg}`);
        return null;
      }
    },
    [programL1, l1Connection]
  );

  // ER delegation is blocked (§14 — MagicBlock Rust SDK dependency conflicts,
  // no ETA). Match always runs on L1; nothing to commit or undelegate.
  // Keeping the signature so call sites don't need touching.
  const commitAndUndelegateMatch = useCallback(
    async (_matchId: BN) => {
      emitToast("info", "Match was L1-only; no commit needed");
      return null;
    },
    []
  );

  /**
   * Scans the network for an open LobbyState (guest == None)
   * The Option<Pubkey> for guest starts at offset 80:
   * 8 (disc) + 8 (match_id) + 32 (host) + 32 (host_commit) = 80 bytes.
   * If byte 80 is 0, the option is None.
   */
  const findOpenLobby = useCallback(async () => {
    if (!programL1) return null;
    try {
      const lobbies = await programL1.account.lobbyState.all([
        {
          memcmp: {
            offset: 80,
            bytes: bs58.encode(Uint8Array.from([0])),
          },
        },
      ]);
      if (lobbies.length > 0) {
        // Return the first available match ID
        return lobbies[0].account.matchId as BN;
      }
      return null;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[findOpenLobby] error:", err);
      return null;
    }
  }, [programL1]);

  const initMatch = useCallback(
    async ({
      matchId,
      opponent,
      opponentCommit,
      opponentSecret,
    }: {
      matchId: BN;
      opponent: PublicKey;
      opponentCommit: Uint8Array;
      opponentSecret: Uint8Array;
    }) => {
      if (!program || !wallet.publicKey) {
        emitToast("error", "Wallet not connected");
        return null;
      }
      setBusy(true);
      try {
        let secret = recallSecret(matchId.toString());
        if (!secret) {
          const fresh = generateCommitReveal();
          secret = fresh.secret;
          stashSecret(matchId.toString(), secret);
        }
        const myCommit = keccak_256(secret);

        const sig = await program.methods
          .initMatch(
            matchId,
            Array.from(myCommit),
            Array.from(opponentCommit),
            Array.from(secret),
            Array.from(opponentSecret)
          )
          .accounts({
            matchState: matchPda(matchId),
            playerOne: wallet.publicKey,
            playerTwo: opponent,
            payer: wallet.publicKey,
            slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
            systemProgram: SystemProgram.programId,
          } as never)
          .rpc({ commitment: "confirmed" });

        emitToast("success", `Match seeded · ${sig.slice(0, 8)}…`);
        return sig;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitToast("error", `init_match failed · ${msg}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [program, wallet.publicKey]
  );

  const playCard = useCallback(
    async ({
      matchId,
      slot,
      card,
      currentTurnAuthority,
    }: {
      matchId: BN;
      slot: number;
      card: RoletCard;
      /** The wallet pubkey of whoever's turn it currently is (from MatchState) */
      currentTurnAuthority: PublicKey;
    }) => {
      if (!program || !wallet.publicKey) {
        emitToast("error", "Wallet not connected");
        return null;
      }
      if (slot < 0 || slot > 3) {
        emitToast("error", "Invalid slot index");
        return null;
      }

      setBusy(true);
      try {
        const accounts = {
          matchState: matchPda(matchId),
          currentProfile: profilePda(currentTurnAuthority),
          actor: sessionKey
            ? sessionKey.keypair.publicKey
            : wallet.publicKey,
        };

        // CRITICAL: until Rust-side delegate_match_state is implemented,
        // route ALL play_card / pull_trigger txs through L1 even when a
        // session key is armed. ER endpoint accepts the tx but doesn't
        // write to the un-delegated PDA → state silently doesn't change.
        const target = programL1;

        let sig: string;
        if (ephemeral && sessionKey) {
          const ix = await target.methods
            .playCard(slot, cardArg(card) as never)
            .accounts(accounts as never)
            .instruction();
          const tx = new Transaction().add(ix);
          sig = await sendWithSessionKey(tx);
        } else {
          sig = await target.methods
            .playCard(slot, cardArg(card) as never)
            .accounts(accounts as never)
            .rpc();
        }

        emitToast("success", `Played ${card} · ${sig.slice(0, 6)}…`);
        return sig;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitToast("error", `play_card failed · ${msg}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [programL1, wallet.publicKey, sessionKey, ephemeral, sendWithSessionKey]
  );

  const pullTrigger = useCallback(
    async ({
      matchId,
      targetSelf,
      currentTurnAuthority,
    }: {
      matchId: BN;
      targetSelf: boolean;
      currentTurnAuthority: PublicKey;
    }) => {
      if (!program || !wallet.publicKey) {
        emitToast("error", "Wallet not connected");
        return null;
      }
      setBusy(true);
      try {
        const accounts = {
          matchState: matchPda(matchId),
          currentProfile: profilePda(currentTurnAuthority),
          actor: sessionKey
            ? sessionKey.keypair.publicKey
            : wallet.publicKey,
        };

        const target = ephemeral && sessionKey && programER ? programER : programL1;

        let sig: string;
        if (ephemeral && sessionKey) {
          const ix = await target.methods
            .pullTrigger(targetSelf)
            .accounts(accounts as never)
            .instruction();
          const tx = new Transaction().add(ix);
          sig = await sendWithSessionKey(tx);
        } else {
          sig = await target.methods
            .pullTrigger(targetSelf)
            .accounts(accounts as never)
            .rpc();
        }

        emitToast(
          targetSelf ? "info" : "success",
          `Trigger pulled → ${
            targetSelf ? "SELF" : "OPPONENT"
          } · ${sig.slice(0, 6)}…`
        );
        return sig;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitToast("error", `pull_trigger failed · ${msg}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [programL1, wallet.publicKey, sessionKey, ephemeral, sendWithSessionKey]
  );

  const initProfile = useCallback(
    async ({
      snsDomain,
      characterNft,
      durabilityMax = 10,
    }: {
      snsDomain: string;
      characterNft?: PublicKey;
      durabilityMax?: number;
    }) => {
      if (!program || !wallet.publicKey) {
        emitToast("error", "Wallet not connected");
        return null;
      }
      if (snsDomain.length === 0 || snsDomain.length > 32) {
        emitToast("error", "SNS domain must be 1–32 chars");
        return null;
      }
      setBusy(true);
      try {
        const sig = await program.methods
          .initPlayerProfile(
            snsDomain,
            characterNft ?? SystemProgram.programId,
            durabilityMax
          )
          .accounts({
            profile: profilePda(wallet.publicKey),
            authority: wallet.publicKey,
            systemProgram: SystemProgram.programId,
          } as never)
          .rpc({ commitment: "confirmed" });
        emitToast("success", `Profile created · ${sig.slice(0, 8)}…`);
        return sig;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitToast("error", `init_profile failed · ${msg}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [program, wallet.publicKey]
  );

  const fetchProfile = useCallback(
    async (authority?: PublicKey) => {
      if (!program) return null;
      const who = authority ?? wallet.publicKey;
      if (!who) return null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (program.account as any).playerProfile.fetch(profilePda(who));
      } catch {
        return null;
      }
    },
    [program, wallet.publicKey]
  );

  const fetchVault = useCallback(async () => {
    if (!program) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (program.account as any).gameVault.fetch(vaultPda());
    } catch {
      return null;
    }
  }, [program]);

  /**
   * Finalize a Completed match. Reads the winner from on-chain state, derives
   * their reward ATA (creating it if missing), then calls settle_match.
   * Anyone can call — the winner's wallet doesn't have to be the signer.
   */
  const settleMatch = useCallback(
    async (matchId: BN) => {
      if (!programL1 || !wallet.publicKey || !wallet.signTransaction) {
        emitToast("error", "Wallet not connected");
        return null;
      }
      setBusy(true);
      try {
        // 1. Pull the match + vault state to learn winner + reward mint.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m: any = await (programL1.account as any).matchState.fetch(
          matchPda(matchId),
        );
        if (!m.winner) {
          emitToast("error", "Match has no winner recorded");
          return null;
        }
        const winnerPk: PublicKey = m.winner;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v: any = await (programL1.account as any).gameVault.fetch(vaultPda());
        const rewardMint: PublicKey = v.rewardMint;
        const treasuryAta: PublicKey = v.treasuryAta;

        // 2. Derive winner ATA. Create it if missing (single tx with settle).
        const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
          "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
        );
        const TOKEN_PROGRAM_ID = new PublicKey(
          "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        );
        const [winnerAta] = PublicKey.findProgramAddressSync(
          [winnerPk.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), rewardMint.toBuffer()],
          ASSOCIATED_TOKEN_PROGRAM_ID,
        );

        const ataInfo = await l1Connection.getAccountInfo(winnerAta);
        const tx = new Transaction();
        if (!ataInfo) {
          // Manually craft create_associated_token_account ix (avoids
          // needing @solana/spl-token at the hook level).
          tx.add({
            keys: [
              { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
              { pubkey: winnerAta, isSigner: false, isWritable: true },
              { pubkey: winnerPk, isSigner: false, isWritable: false },
              { pubkey: rewardMint, isSigner: false, isWritable: false },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
              { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            ],
            programId: ASSOCIATED_TOKEN_PROGRAM_ID,
            data: Buffer.from([]),
          });
        }

        const settleIx = await programL1.methods
          .settleMatch()
          .accounts({
            matchState: matchPda(matchId),
            profileOne: profilePda(m.playerOne),
            profileTwo: profilePda(m.playerTwo),
            vault: vaultPda(),
            treasuryAta,
            winnerTokenAccount: winnerAta,
            winner: winnerPk,
            rewardMint,
            rentRefund: wallet.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as never)
          .instruction();
        tx.add(settleIx);

        tx.feePayer = wallet.publicKey;
        tx.recentBlockhash = (await l1Connection.getLatestBlockhash()).blockhash;
        const signed = await wallet.signTransaction(tx);
        const sig = await l1Connection.sendRawTransaction(signed.serialize());
        await l1Connection.confirmTransaction(sig, "confirmed");
        emitToast("success", `Match settled · ${sig.slice(0, 6)}…`);
        return sig;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("does not exist") || msg.includes("has no data")) {
          emitToast("info", "Match already settled");
          return null;
        }
        emitToast("error", `settle_match failed · ${msg}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [programL1, wallet, l1Connection]
  );

  const openLobby = useCallback(
    async (matchId: BN, hostCommit: Uint8Array) => {
      if (!programL1 || !wallet.publicKey) {
        emitToast("error", "Wallet not connected");
        return null;
      }
      setBusy(true);
      try {
        const sig = await programL1.methods
          .openLobby(matchId, Array.from(hostCommit))
          .accounts({
            lobby: lobbyPda(matchId),
            host: wallet.publicKey,
            systemProgram: SystemProgram.programId,
          } as never)
          .rpc({ commitment: "confirmed" });
        emitToast("success", `Lobby opened · ${sig.slice(0, 6)}…`);
        return sig;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitToast("error", `open_lobby failed · ${msg}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [programL1, wallet.publicKey]
  );

  const joinLobby = useCallback(
    async (matchId: BN, guestCommit: Uint8Array, guestSecret: Uint8Array) => {
      if (!programL1 || !wallet.publicKey) {
        emitToast("error", "Wallet not connected");
        return null;
      }
      setBusy(true);
      try {
        const sig = await programL1.methods
          .joinLobby(Array.from(guestCommit), Array.from(guestSecret))
          .accounts({
            lobby: lobbyPda(matchId),
            guest: wallet.publicKey,
          } as never)
          .rpc({ commitment: "confirmed" });
        emitToast("success", `Joined lobby · ${sig.slice(0, 6)}…`);
        return sig;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitToast("error", `join_lobby failed · ${msg}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [programL1, wallet.publicKey]
  );

  const fetchLobby = useCallback(
    async (matchId: BN) => {
      if (!programL1) return null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (programL1.account as any).lobbyState.fetch(lobbyPda(matchId));
      } catch {
        return null;
      }
    },
    [programL1]
  );

  const closeLobby = useCallback(
    async (matchId: BN) => {
      if (!programL1 || !wallet.publicKey) return null;
      try {
        const sig = await programL1.methods
          .closeLobby()
          .accounts({
            lobby: lobbyPda(matchId),
            host: wallet.publicKey,
          } as never)
          .rpc({ commitment: "confirmed" });
        emitToast("info", `Lobby closed · ${sig.slice(0, 6)}…`);
        return sig;
      } catch {
        return null;
      }
    },
    [programL1, wallet.publicKey]
  );

  const subscribeMatch = useCallback(
    (_matchId: BN, _onChange: (state: unknown) => void) => {
      // PLAN_B: Helius free tier blocks WebSocket. The HTTP poll inside
      // ActiveDuel covers state updates without console-spamming the user
      // with `Connection._wsOnError` events. Subscribe is now a no-op.
      return () => {};
    },
    []
  );

  const fetchMatch = useCallback(
    async (matchId: BN) => {
      if (!program) return null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (program.account as any).matchState.fetch(matchPda(matchId));
      } catch {
        return null;
      }
    },
    [program]
  );

  return {
    program,
    connection,
    isEphemeral: ephemeral,
    sessionKey: sessionKey?.keypair.publicKey ?? null,
    busy,
    startSession,
    pda: { match: matchPda, profile: profilePda, vault: vaultPda, lobby: lobbyPda },
    initMatch,
    delegateMatch,
    commitAndUndelegateMatch,
    setupGhost,
    ghostPullTrigger,
    settleMatch,
    playCard,
    pullTrigger,
    initProfile,
    fetchProfile,
    fetchVault,
    fetchMatch,
    subscribeMatch,
    generateCommitReveal,
    openLobby,
    joinLobby,
    fetchLobby,
    closeLobby,
  };
}
