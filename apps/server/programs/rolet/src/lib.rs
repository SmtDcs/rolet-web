// ROLET — Fully on-chain duel program
// Combines Tasks 1-3: data structures, ER game loop, L1 settlement.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

// PLAN_B: MagicBlock ER SDK is NOT linked into this Rust program. The SDK
// (versions 0.10–0.13) ships with a transitive dlp_api crate that pulls in a
// newer solana-instruction than Anchor 0.30.1 brings, causing Address vs
// Pubkey type splits. Workaround: delegation lifecycle (delegate, commit,
// undelegate) is handled entirely from the frontend via the TypeScript SDK
// (@magicblock-labs/ephemeral-rollups-sdk). Once delegated, MatchState
// reads/writes happen via the ER endpoint and our existing instructions
// (play_card, pull_trigger) execute there unchanged — the runtime is the
// same Solana runtime, the SDK only mediates account ownership transitions.

declare_id!("2ePEUzCFcxD559Hy3irB2TGbYAwU2UD352sVj77QPrS7");

// ============================================================
// Constants
// ============================================================
pub const STARTING_HP: u8 = 4;
pub const CHAMBER_COUNT: u8 = 8;
pub const LIVE_ROUNDS: u8 = 5;
pub const BLANK_ROUNDS: u8 = 3;
pub const HAND_SIZE: usize = 4;
pub const CARD_VARIANTS: u8 = 12;
pub const TURN_TIMEOUT_SLOTS: u64 = 150;

#[program]
pub mod rolet {
    use super::*;

    // --------------------------------------------------------
    // INIT_MATCH — seeds chambers + deals starting hands
    // --------------------------------------------------------
    pub fn init_match(
        ctx: Context<InitMatch>,
        match_id: u64,
        player_one_commit: [u8; 32],
        player_two_commit: [u8; 32],
        player_one_secret: [u8; 32],
        player_two_secret: [u8; 32],
    ) -> Result<()> {
        require!(
            keccak::hash(&player_one_secret).0 == player_one_commit,
            RoletError::InvalidReveal
        );
        require!(
            keccak::hash(&player_two_secret).0 == player_two_commit,
            RoletError::InvalidReveal
        );

        let clock = Clock::get()?;
        let recent_slothash = ctx.accounts.slot_hashes.data.borrow();
        let mut slot_entropy = [0u8; 32];
        slot_entropy.copy_from_slice(&recent_slothash[16..48]);

        let seed = keccak::hashv(&[
            &player_one_secret,
            &player_two_secret,
            &slot_entropy,
            &match_id.to_le_bytes(),
            &clock.unix_timestamp.to_le_bytes(),
        ])
        .0;

        let m = &mut ctx.accounts.match_state;
        m.match_id = match_id;
        m.player_one = ctx.accounts.player_one.key();
        m.player_two = ctx.accounts.player_two.key();
        m.player_one_hp = STARTING_HP;
        m.player_two_hp = STARTING_HP;
        m.turn_number = 0;
        m.status = MatchStatus::Active;
        m.winner = None;
        m.silence_target = None;
        m.blocker_active_for = None;
        m.double_strike_for = None;
        m.revealed_chamber = None;
        m.skip_turn_for = None;
        m.last_action_slot = clock.slot;
        m.started_at = clock.unix_timestamp;
        m.bump = ctx.bumps.match_state;

        m.current_turn = if seed[0] & 1 == 0 {
            m.player_one
        } else {
            m.player_two
        };

        m.gun = build_gun(&seed);
        m.player_one_cards = deal_hand(&seed, 0xA1);
        m.player_two_cards = deal_hand(&seed, 0xB2);

        emit!(MatchInitialized {
            match_id,
            seed,
            first_turn: m.current_turn,
        });
        Ok(())
    }

    // --------------------------------------------------------
    // PLAY_CARD — applies card effects
    // --------------------------------------------------------
    pub fn play_card(ctx: Context<PlayCard>, slot: u8, card: Card) -> Result<()> {
        let signer = ctx.accounts.actor.key();
        let now = Clock::get()?.unix_timestamp;

        // Resolve "real" actor — wallet OR registered session key for the
        // current player's profile (PlayerProfile lives on L1; ER reads it
        // transparently as a non-delegated read-only account).
        let actor = resolve_actor(
            signer,
            &ctx.accounts.current_profile,
            ctx.accounts.match_state.current_turn,
            now,
        )?;

        let m = &mut ctx.accounts.match_state;
        require!(m.status == MatchStatus::Active, RoletError::MatchNotActive);
        require!(m.current_turn == actor, RoletError::NotYourTurn);
        require!(
            m.silence_target != Some(actor),
            RoletError::SilencedThisTurn
        );
        require!((slot as usize) < HAND_SIZE, RoletError::InvalidSlot);

        let hand = if actor == m.player_one {
            &mut m.player_one_cards
        } else {
            &mut m.player_two_cards
        };
        let held = hand.slots[slot as usize].ok_or(RoletError::EmptySlot)?;
        require!(held == card, RoletError::CardMismatch);
        hand.slots[slot as usize] = None;

        match card {
            Card::HawkEye => {
                let idx = m.gun.current_chamber;
                require!(idx < CHAMBER_COUNT, RoletError::ChamberOutOfRange);
                require!(
                    m.gun.chambers[idx as usize] != Chamber::Empty,
                    RoletError::ChamberAlreadyFired
                );
                m.revealed_chamber = Some(idx);
                emit!(CardPlayed { actor, card, detail: idx as u64 });
            }
            Card::BulletExtractor => {
                let idx = m.gun.current_chamber as usize;
                require!(idx < CHAMBER_COUNT as usize, RoletError::ChamberOutOfRange);
                let ejected = m.gun.chambers[idx];
                require!(ejected != Chamber::Empty, RoletError::ChamberAlreadyFired);
                match ejected {
                    Chamber::Live => m.gun.loaded_count = m.gun.loaded_count.saturating_sub(1),
                    Chamber::Blank => m.gun.blank_count = m.gun.blank_count.saturating_sub(1),
                    Chamber::Empty => unreachable!(),
                }
                m.gun.chambers[idx] = Chamber::Empty;
                m.gun.current_chamber = m.gun.current_chamber.saturating_add(1);
                m.revealed_chamber = None;
                emit!(CardPlayed { actor, card, detail: idx as u64 });
            }
            Card::Silence => {
                let opponent = if actor == m.player_one { m.player_two } else { m.player_one };
                m.silence_target = Some(opponent);
                emit!(CardPlayed { actor, card, detail: 0 });
            }
            Card::Blocker => {
                m.blocker_active_for = Some(actor);
                emit!(CardPlayed { actor, card, detail: 0 });
            }
            Card::DoubleStrike => {
                m.double_strike_for = Some(actor);
                emit!(CardPlayed { actor, card, detail: 0 });
            }
            Card::Healer => {
                if actor == m.player_one {
                    m.player_one_hp = (m.player_one_hp.saturating_add(1)).min(STARTING_HP);
                } else {
                    m.player_two_hp = (m.player_two_hp.saturating_add(1)).min(STARTING_HP);
                }
                emit!(CardPlayed { actor, card, detail: 1 });
            }
            Card::RestoreBullet => {
                // Find the first Empty chamber and reload it as Live.
                let mut found: Option<usize> = None;
                for (i, c) in m.gun.chambers.iter().enumerate() {
                    if *c == Chamber::Empty {
                        found = Some(i);
                        break;
                    }
                }
                let idx = found.ok_or(RoletError::NoChamberToRestore)?;
                m.gun.chambers[idx] = Chamber::Live;
                m.gun.loaded_count = m.gun.loaded_count.saturating_add(1);
                emit!(CardPlayed { actor, card, detail: idx as u64 });
            }
            Card::Shuffler => {
                // Re-shuffle ONLY the un-fired chambers using fresh entropy.
                let clock = Clock::get()?;
                let reseed = keccak::hashv(&[
                    &m.match_id.to_le_bytes(),
                    &m.turn_number.to_le_bytes(),
                    &clock.slot.to_le_bytes(),
                    b"SHUFFLER",
                ])
                .0;
                // Collect unfired contents
                let mut unfired: Vec<(usize, Chamber)> = m
                    .gun
                    .chambers
                    .iter()
                    .enumerate()
                    .filter(|(_, c)| **c != Chamber::Empty)
                    .map(|(i, c)| (i, *c))
                    .collect();
                let n = unfired.len();
                if n > 1 {
                    let mut stream = reseed;
                    for i in (1..n).rev() {
                        let j = (stream[i % 32] as usize) % (i + 1);
                        unfired.swap(i, j);
                        stream = keccak::hashv(&[&stream, &[i as u8]]).0;
                    }
                    // Write back into the same indices
                    let indices: Vec<usize> = unfired.iter().map(|(i, _)| *i).collect();
                    let contents: Vec<Chamber> = unfired.iter().map(|(_, c)| *c).collect();
                    for (k, idx) in indices.iter().enumerate() {
                        m.gun.chambers[*idx] = contents[k];
                    }
                }
                m.gun.shuffle_seed = u64::from_le_bytes(reseed[0..8].try_into().unwrap());
                m.revealed_chamber = None;
                emit!(CardPlayed { actor, card, detail: n as u64 });
            }
            Card::CardThief => {
                // Steal first non-empty card from opponent into first empty
                // slot in your own hand. Avoid double-borrow of `m` by
                // computing indices first, then mutating one side at a time.
                let actor_is_p1 = actor == m.player_one;
                let (opp_slot, stolen) = {
                    let opp_hand = if actor_is_p1 { &m.player_two_cards } else { &m.player_one_cards };
                    let oi = (0..HAND_SIZE)
                        .find(|i| opp_hand.slots[*i].is_some())
                        .ok_or(RoletError::CardThiefNoTarget)?;
                    (oi, opp_hand.slots[oi])
                };
                let own_slot = {
                    let own_hand = if actor_is_p1 { &m.player_one_cards } else { &m.player_two_cards };
                    (0..HAND_SIZE)
                        .find(|i| own_hand.slots[*i].is_none())
                        .ok_or(RoletError::CardThiefNoTarget)?
                };
                if actor_is_p1 {
                    m.player_two_cards.slots[opp_slot] = None;
                    m.player_one_cards.slots[own_slot] = stolen;
                } else {
                    m.player_one_cards.slots[opp_slot] = None;
                    m.player_two_cards.slots[own_slot] = stolen;
                }
                emit!(CardPlayed { actor, card, detail: opp_slot as u64 });
            }
            Card::RandomInsight => {
                // Reveal a pseudorandom unfired chamber.
                let clock = Clock::get()?;
                let pick_seed = keccak::hashv(&[
                    &m.match_id.to_le_bytes(),
                    &m.turn_number.to_le_bytes(),
                    &clock.slot.to_le_bytes(),
                    b"INSIGHT",
                ])
                .0;
                let unfired: Vec<u8> = m
                    .gun
                    .chambers
                    .iter()
                    .enumerate()
                    .filter(|(_, c)| **c != Chamber::Empty)
                    .map(|(i, _)| i as u8)
                    .collect();
                if unfired.is_empty() {
                    return err!(RoletError::NoUnfiredChambers);
                }
                let pick = unfired[(pick_seed[0] as usize) % unfired.len()];
                m.revealed_chamber = Some(pick);
                emit!(CardPlayed { actor, card, detail: pick as u64 });
            }
            Card::LastChance => {
                // Only playable as a desperation move.
                let actor_hp = if actor == m.player_one { m.player_one_hp } else { m.player_two_hp };
                require!(actor_hp == 1, RoletError::LastChanceRequiresOneHp);
                let opponent = if actor == m.player_one { m.player_two } else { m.player_one };
                m.skip_turn_for = Some(opponent);
                emit!(CardPlayed { actor, card, detail: 0 });
            }
            Card::HandOfFate => {
                // Re-roll the current chamber's content.
                let idx = m.gun.current_chamber as usize;
                require!(idx < CHAMBER_COUNT as usize, RoletError::ChamberOutOfRange);
                let prev = m.gun.chambers[idx];
                require!(prev != Chamber::Empty, RoletError::ChamberAlreadyFired);
                let clock = Clock::get()?;
                let roll = keccak::hashv(&[
                    &m.match_id.to_le_bytes(),
                    &m.turn_number.to_le_bytes(),
                    &clock.slot.to_le_bytes(),
                    b"FATE",
                ])
                .0[0];
                let next = if roll & 1 == 0 { Chamber::Live } else { Chamber::Blank };
                // Update counts based on transition
                match (prev, next) {
                    (Chamber::Live, Chamber::Blank) => {
                        m.gun.loaded_count = m.gun.loaded_count.saturating_sub(1);
                        m.gun.blank_count = m.gun.blank_count.saturating_add(1);
                    }
                    (Chamber::Blank, Chamber::Live) => {
                        m.gun.blank_count = m.gun.blank_count.saturating_sub(1);
                        m.gun.loaded_count = m.gun.loaded_count.saturating_add(1);
                    }
                    _ => {} // unchanged
                }
                m.gun.chambers[idx] = next;
                m.revealed_chamber = None;
                emit!(CardPlayed { actor, card, detail: u8::from(next) as u64 });
            }
        }

        m.last_action_slot = Clock::get()?.slot;
        Ok(())
    }

    // --------------------------------------------------------
    // PULL_TRIGGER — Russian Roulette core mechanic
    // --------------------------------------------------------
    pub fn pull_trigger(ctx: Context<PullTrigger>, target_self: bool) -> Result<()> {
        let signer = ctx.accounts.actor.key();
        let now = Clock::get()?.unix_timestamp;
        let actor = resolve_actor(
            signer,
            &ctx.accounts.current_profile,
            ctx.accounts.match_state.current_turn,
            now,
        )?;

        let m = &mut ctx.accounts.match_state;
        require!(m.status == MatchStatus::Active, RoletError::MatchNotActive);
        require!(m.current_turn == actor, RoletError::NotYourTurn);

        // LastChance: if this player was flagged to be skipped, just consume
        // the flag and pass the turn back without firing.
        if m.skip_turn_for == Some(actor) {
            m.skip_turn_for = None;
            m.current_turn = if actor == m.player_one { m.player_two } else { m.player_one };
            m.turn_number = m.turn_number.saturating_add(1);
            m.last_action_slot = Clock::get()?.slot;
            return Ok(());
        }

        let idx = m.gun.current_chamber;
        require!(idx < CHAMBER_COUNT, RoletError::ChamberOutOfRange);
        let chamber = m.gun.chambers[idx as usize];
        require!(chamber != Chamber::Empty, RoletError::ChamberAlreadyFired);

        let target = if target_self {
            actor
        } else if actor == m.player_one {
            m.player_two
        } else {
            m.player_one
        };

        m.gun.chambers[idx as usize] = Chamber::Empty;
        m.gun.current_chamber = idx.saturating_add(1);
        m.revealed_chamber = None;

        let mut keep_turn = false;

        match chamber {
            Chamber::Live => {
                m.gun.loaded_count = m.gun.loaded_count.saturating_sub(1);
                let mut damage: u8 = 1;
                if m.double_strike_for == Some(actor) {
                    damage = 2;
                    m.double_strike_for = None;
                }
                if m.blocker_active_for == Some(target) {
                    damage = 0;
                    m.blocker_active_for = None;
                }
                if target == m.player_one {
                    m.player_one_hp = m.player_one_hp.saturating_sub(damage);
                } else {
                    m.player_two_hp = m.player_two_hp.saturating_sub(damage);
                }
                emit!(TriggerPulled { actor, target, chamber: chamber.into(), damage });
                if m.player_one_hp == 0 || m.player_two_hp == 0 {
                    m.status = MatchStatus::Completed;
                    m.winner = Some(if m.player_one_hp == 0 { m.player_two } else { m.player_one });
                    // PLAN_B: client observes status == Completed and issues
                    // the undelegate tx via TS SDK before calling settle_match.
                    return Ok(());
                }
            }
            Chamber::Blank => {
                m.gun.blank_count = m.gun.blank_count.saturating_sub(1);
                keep_turn = target_self;
                emit!(TriggerPulled { actor, target, chamber: chamber.into(), damage: 0 });
            }
            Chamber::Empty => unreachable!(),
        }

        if m.silence_target == Some(actor) {
            m.silence_target = None;
        }

        if !keep_turn {
            m.current_turn = if actor == m.player_one { m.player_two } else { m.player_one };
            m.turn_number = m.turn_number.saturating_add(1);
        }

        if m.gun.loaded_count == 0 && m.gun.blank_count == 0 {
            let clock = Clock::get()?;
            let reseed = keccak::hashv(&[
                &m.match_id.to_le_bytes(),
                &m.turn_number.to_le_bytes(),
                &clock.slot.to_le_bytes(),
            ])
            .0;
            m.gun = build_gun(&reseed);
        }

        m.last_action_slot = Clock::get()?.slot;
        Ok(())
    }

    // --------------------------------------------------------
    // SETTLE_MATCH — L1 finalization after ER commit
    // --------------------------------------------------------
    pub fn settle_match(ctx: Context<SettleMatch>) -> Result<()> {
        let m = &ctx.accounts.match_state;
        require!(m.status == MatchStatus::Completed, RoletError::MatchNotCompleted);
        let winner_key = m.winner.ok_or(RoletError::WinnerNotSet)?;

        let p1_key = ctx.accounts.profile_one.authority;
        let p2_key = ctx.accounts.profile_two.authority;
        require!(
            (p1_key == m.player_one && p2_key == m.player_two)
                || (p1_key == m.player_two && p2_key == m.player_one),
            RoletError::ProfileMismatch
        );
        require!(
            winner_key == p1_key || winner_key == p2_key,
            RoletError::WinnerMismatch
        );
        require!(
            ctx.accounts.winner_token_account.owner == winner_key,
            RoletError::WinnerAtaMismatch
        );
        require!(
            ctx.accounts.winner_token_account.mint == ctx.accounts.vault.reward_mint,
            RoletError::RewardMintMismatch
        );
        require!(
            ctx.accounts.treasury_ata.key() == ctx.accounts.vault.treasury_ata,
            RoletError::TreasuryMismatch
        );

        let p1 = &mut ctx.accounts.profile_one;
        let p2 = &mut ctx.accounts.profile_two;
        p1.durability_remaining = p1.durability_remaining.saturating_sub(1);
        p2.durability_remaining = p2.durability_remaining.saturating_sub(1);

        let reward = ctx.accounts.vault.base_reward_per_match;
        if winner_key == p1.authority {
            p1.stats.wins = p1.stats.wins.saturating_add(1);
            p2.stats.losses = p2.stats.losses.saturating_add(1);
            p1.stats.total_rewards_claimed = p1.stats.total_rewards_claimed.saturating_add(reward);
        } else {
            p2.stats.wins = p2.stats.wins.saturating_add(1);
            p1.stats.losses = p1.stats.losses.saturating_add(1);
            p2.stats.total_rewards_claimed = p2.stats.total_rewards_claimed.saturating_add(reward);
        }
        p1.stats.matches_played = p1.stats.matches_played.saturating_add(1);
        p2.stats.matches_played = p2.stats.matches_played.saturating_add(1);

        require!(
            ctx.accounts.treasury_ata.amount >= reward,
            RoletError::InsufficientVault
        );

        let vault = &mut ctx.accounts.vault;
        let vault_seeds: &[&[u8]] = &[b"vault", core::slice::from_ref(&vault.bump)];
        let signer_seeds: &[&[&[u8]]] = &[vault_seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.treasury_ata.to_account_info(),
                    to: ctx.accounts.winner_token_account.to_account_info(),
                    authority: vault.to_account_info(),
                },
                signer_seeds,
            ),
            reward,
        )?;

        vault.total_paid_out = vault.total_paid_out.saturating_add(reward);
        vault.matches_settled = vault.matches_settled.saturating_add(1);

        emit!(MatchSettled {
            match_id: m.match_id,
            winner: winner_key,
            loser: if winner_key == p1.authority { p2.authority } else { p1.authority },
            reward,
            p1_durability_remaining: p1.durability_remaining,
            p2_durability_remaining: p2.durability_remaining,
        });
        Ok(())
    }

    // --------------------------------------------------------
    // INIT_PLAYER_PROFILE — one-time per wallet onboarding
    // --------------------------------------------------------
    pub fn init_player_profile(
        ctx: Context<InitPlayerProfile>,
        sns_domain: String,
        character_nft: Pubkey,
        durability_max: u8,
    ) -> Result<()> {
        require!(sns_domain.len() <= 32, RoletError::SnsDomainTooLong);
        require!(durability_max > 0, RoletError::InvalidDurability);

        let clock = Clock::get()?;
        let p = &mut ctx.accounts.profile;
        p.authority = ctx.accounts.authority.key();
        p.sns_domain = sns_domain;
        p.character_nft = character_nft;
        p.durability_remaining = durability_max;
        p.durability_max = durability_max;
        p.stats = PlayerStats {
            matches_played: 0,
            wins: 0,
            losses: 0,
            total_damage_dealt: 0,
            total_rewards_claimed: 0,
            elo_rating: 1000,
        };
        p.session_key = None;
        p.session_key_expiry = 0;
        p.created_at = clock.unix_timestamp;
        p.bump = ctx.bumps.profile;

        emit!(ProfileCreated {
            authority: p.authority,
            sns_domain: p.sns_domain.clone(),
            character_nft: p.character_nft,
        });
        Ok(())
    }

    // --------------------------------------------------------
    // INIT_VAULT — one-time admin bootstrap (deploy script)
    // --------------------------------------------------------
    // --------------------------------------------------------
    // REGISTER_SESSION_KEY — wallet authorizes a temp keypair (L1)
    // After this, that keypair can sign play_card / pull_trigger txs
    // until expiry without ever opening Phantom again.
    // --------------------------------------------------------
    pub fn register_session_key(
        ctx: Context<RegisterSessionKey>,
        session_pubkey: Pubkey,
        duration_seconds: i64,
    ) -> Result<()> {
        require!(duration_seconds > 0, RoletError::InvalidSessionDuration);
        require!(duration_seconds <= 24 * 60 * 60, RoletError::InvalidSessionDuration);

        let now = Clock::get()?.unix_timestamp;
        let p = &mut ctx.accounts.profile;
        p.session_key = Some(session_pubkey);
        p.session_key_expiry = now.saturating_add(duration_seconds);

        emit!(SessionKeyRegistered {
            authority: p.authority,
            session_key: session_pubkey,
            expires_at: p.session_key_expiry,
        });
        Ok(())
    }

    // PLAN_B: delegate_match_state / undelegate_match_state moved to the
    // frontend (@magicblock-labs/ephemeral-rollups-sdk constructs the
    // Delegation Program CPIs directly).

    pub fn init_vault(
        ctx: Context<InitVault>,
        base_reward_per_match: u64,
    ) -> Result<()> {
        let v = &mut ctx.accounts.vault;
        v.authority = ctx.accounts.authority.key();
        v.reward_mint = ctx.accounts.reward_mint.key();
        v.treasury_ata = ctx.accounts.treasury_ata.key();
        v.total_deposited = 0;
        v.total_paid_out = 0;
        v.base_reward_per_match = base_reward_per_match;
        v.matches_settled = 0;
        v.bump = ctx.bumps.vault;

        emit!(VaultInitialized {
            authority: v.authority,
            reward_mint: v.reward_mint,
            base_reward_per_match,
        });
        Ok(())
    }

    // --------------------------------------------------------
    // OPEN_LOBBY — host creates a waiting room PDA
    // --------------------------------------------------------
    pub fn open_lobby(
        ctx: Context<OpenLobby>,
        match_id: u64,
        host_commit: [u8; 32],
    ) -> Result<()> {
        let lobby = &mut ctx.accounts.lobby;
        lobby.match_id = match_id;
        lobby.host = ctx.accounts.host.key();
        lobby.host_commit = host_commit;
        lobby.guest = None;
        lobby.guest_commit = [0u8; 32];
        lobby.guest_secret = [0u8; 32];
        lobby.bump = ctx.bumps.lobby;
        emit!(LobbyOpened { match_id, host: lobby.host });
        Ok(())
    }

    // --------------------------------------------------------
    // JOIN_LOBBY — guest fills the second seat
    // --------------------------------------------------------
    pub fn join_lobby(
        ctx: Context<JoinLobby>,
        guest_commit: [u8; 32],
        guest_secret: [u8; 32],
    ) -> Result<()> {
        require!(
            keccak::hash(&guest_secret).0 == guest_commit,
            RoletError::InvalidReveal
        );
        let lobby = &mut ctx.accounts.lobby;
        require!(lobby.guest.is_none(), RoletError::LobbyFull);
        require!(
            ctx.accounts.guest.key() != lobby.host,
            RoletError::CannotSelfMatch
        );
        lobby.guest = Some(ctx.accounts.guest.key());
        lobby.guest_commit = guest_commit;
        lobby.guest_secret = guest_secret;
        emit!(LobbyReady {
            match_id: lobby.match_id,
            host: lobby.host,
            guest: ctx.accounts.guest.key(),
        });
        Ok(())
    }

    // --------------------------------------------------------
    // CLOSE_LOBBY — host reclaims rent after match is launched
    // --------------------------------------------------------
    pub fn close_lobby(_ctx: Context<CloseLobby>) -> Result<()> {
        Ok(())
    }
}

// ============================================================
// Actor resolution — wallet OR registered session key
// ============================================================
fn resolve_actor(
    signer: Pubkey,
    profile: &Account<PlayerProfile>,
    expected: Pubkey,
    now: i64,
) -> Result<Pubkey> {
    // Fast path: signer is the wallet itself.
    if signer == expected {
        return Ok(signer);
    }
    // Session-key path: signer must be the profile's registered session key
    // and not be expired.
    if let Some(sk) = profile.session_key {
        if sk == signer && profile.session_key_expiry > now {
            return Ok(profile.authority);
        }
    }
    err!(RoletError::UnauthorizedActor)
}

// ============================================================
// Deterministic PRNG helpers
// ============================================================
fn build_gun(seed: &[u8; 32]) -> GunState {
    let mut chambers = [Chamber::Empty; 8];
    for i in 0..LIVE_ROUNDS as usize {
        chambers[i] = Chamber::Live;
    }
    for i in 0..BLANK_ROUNDS as usize {
        chambers[LIVE_ROUNDS as usize + i] = Chamber::Blank;
    }
    let mut stream = keccak::hashv(&[seed, b"GUN"]).0;
    for i in (1..CHAMBER_COUNT as usize).rev() {
        let j = (stream[i % 32] as usize) % (i + 1);
        chambers.swap(i, j);
        stream = keccak::hashv(&[&stream, &[i as u8]]).0;
    }
    GunState {
        chambers,
        current_chamber: 0,
        loaded_count: LIVE_ROUNDS,
        blank_count: BLANK_ROUNDS,
        shuffle_seed: u64::from_le_bytes(seed[0..8].try_into().unwrap()),
    }
}

fn deal_hand(seed: &[u8; 32], domain: u8) -> CardHand {
    let mut stream = keccak::hashv(&[seed, &[domain]]).0;
    let mut slots: [Option<Card>; HAND_SIZE] = [None; HAND_SIZE];
    for i in 0..HAND_SIZE {
        let pick = stream[i] % CARD_VARIANTS;
        slots[i] = Some(card_from_index(pick));
        stream = keccak::hashv(&[&stream, &[i as u8, domain]]).0;
    }
    CardHand { slots }
}

fn card_from_index(i: u8) -> Card {
    match i {
        0 => Card::RestoreBullet,
        1 => Card::HawkEye,
        2 => Card::Silence,
        3 => Card::Blocker,
        4 => Card::BulletExtractor,
        5 => Card::Shuffler,
        6 => Card::DoubleStrike,
        7 => Card::Healer,
        8 => Card::CardThief,
        9 => Card::RandomInsight,
        10 => Card::LastChance,
        _ => Card::HandOfFate,
    }
}

impl From<Chamber> for u8 {
    fn from(c: Chamber) -> u8 {
        match c {
            Chamber::Empty => 0,
            Chamber::Blank => 1,
            Chamber::Live => 2,
        }
    }
}

// ============================================================
// L1 STATE
// ============================================================
#[account]
#[derive(InitSpace)]
pub struct PlayerProfile {
    pub authority: Pubkey,
    #[max_len(32)]
    pub sns_domain: String,
    pub character_nft: Pubkey,
    pub durability_remaining: u8,
    pub durability_max: u8,
    pub stats: PlayerStats,
    pub session_key: Option<Pubkey>,
    pub session_key_expiry: i64,
    pub created_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct PlayerStats {
    pub matches_played: u32,
    pub wins: u32,
    pub losses: u32,
    pub total_damage_dealt: u64,
    pub total_rewards_claimed: u64,
    pub elo_rating: u16,
}

#[account]
#[derive(InitSpace)]
pub struct GameVault {
    pub authority: Pubkey,
    pub reward_mint: Pubkey,
    pub treasury_ata: Pubkey,
    pub total_deposited: u64,
    pub total_paid_out: u64,
    pub base_reward_per_match: u64,
    pub matches_settled: u64,
    pub bump: u8,
}

// ============================================================
// LOBBY STATE (L1, temporary — closed after match launches)
// ============================================================
#[account]
#[derive(InitSpace)]
pub struct LobbyState {
    pub match_id: u64,
    pub host: Pubkey,
    pub host_commit: [u8; 32],
    pub guest: Option<Pubkey>,
    pub guest_commit: [u8; 32],
    pub guest_secret: [u8; 32],
    pub bump: u8,
}

// ============================================================
// EPHEMERAL STATE (delegated to MagicBlock ER)
// ============================================================
#[account]
#[derive(InitSpace)]
pub struct MatchState {
    pub match_id: u64,
    pub player_one: Pubkey,
    pub player_two: Pubkey,
    pub player_one_hp: u8,
    pub player_two_hp: u8,
    pub current_turn: Pubkey,
    pub turn_number: u16,
    pub gun: GunState,
    pub player_one_cards: CardHand,
    pub player_two_cards: CardHand,
    pub status: MatchStatus,
    pub winner: Option<Pubkey>,
    pub silence_target: Option<Pubkey>,
    pub blocker_active_for: Option<Pubkey>,
    pub double_strike_for: Option<Pubkey>,
    pub revealed_chamber: Option<u8>,
    /// Player whose next turn will be skipped entirely (LastChance card).
    pub skip_turn_for: Option<Pubkey>,
    pub last_action_slot: u64,
    pub started_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum MatchStatus {
    AwaitingOpponent,
    Active,
    Completed,
    Abandoned,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct GunState {
    pub chambers: [Chamber; 8],
    pub current_chamber: u8,
    pub loaded_count: u8,
    pub blank_count: u8,
    pub shuffle_seed: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum Chamber {
    Empty,
    Blank,
    Live,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct CardHand {
    pub slots: [Option<Card>; 4],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum Card {
    RestoreBullet,
    HawkEye,
    Silence,
    Blocker,
    BulletExtractor,
    Shuffler,
    DoubleStrike,
    Healer,
    CardThief,
    RandomInsight,
    LastChance,
    HandOfFate,
}

// ============================================================
// Account contexts
// ============================================================
// NOTE: All large Account<...> fields are wrapped in Box<...> to push
// account deserialization buffers onto the heap instead of the 4 KB
// program stack. Required for SettleMatch (10+ accounts including two
// large PlayerProfiles) and prophylactic for InitMatch.
#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct InitMatch<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + MatchState::INIT_SPACE,
        seeds = [b"match", match_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub match_state: Box<Account<'info, MatchState>>,
    /// CHECK: pubkey only — signature verified at lobby join
    pub player_one: UncheckedAccount<'info>,
    /// CHECK: pubkey only — signature verified at lobby join
    pub player_two: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: SlotHashes sysvar — read-only, address-validated
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlayCard<'info> {
    #[account(
        mut,
        seeds = [b"match", match_state.match_id.to_le_bytes().as_ref()],
        bump = match_state.bump,
    )]
    pub match_state: Box<Account<'info, MatchState>>,

    /// Profile of whoever's turn it currently is — used to verify session
    /// keys. Anchor reads this from L1 even when the rest of the ix is
    /// executing inside the Ephemeral Rollup.
    #[account(
        seeds = [b"profile", current_profile.authority.as_ref()],
        bump = current_profile.bump,
        constraint = current_profile.authority == match_state.current_turn
            @ RoletError::ProfileMismatch,
    )]
    pub current_profile: Box<Account<'info, PlayerProfile>>,

    pub actor: Signer<'info>,
}

#[derive(Accounts)]
pub struct PullTrigger<'info> {
    #[account(
        mut,
        seeds = [b"match", match_state.match_id.to_le_bytes().as_ref()],
        bump = match_state.bump,
    )]
    pub match_state: Box<Account<'info, MatchState>>,

    #[account(
        seeds = [b"profile", current_profile.authority.as_ref()],
        bump = current_profile.bump,
        constraint = current_profile.authority == match_state.current_turn
            @ RoletError::ProfileMismatch,
    )]
    pub current_profile: Box<Account<'info, PlayerProfile>>,

    #[account(mut)]
    pub actor: Signer<'info>,
}

#[derive(Accounts)]
pub struct SettleMatch<'info> {
    #[account(
        mut,
        seeds = [b"match", match_state.match_id.to_le_bytes().as_ref()],
        bump = match_state.bump,
        close = rent_refund,
    )]
    pub match_state: Box<Account<'info, MatchState>>,

    #[account(
        mut,
        seeds = [b"profile", match_state.player_one.as_ref()],
        bump = profile_one.bump,
        constraint = profile_one.authority == match_state.player_one
            @ RoletError::ProfileMismatch,
    )]
    pub profile_one: Box<Account<'info, PlayerProfile>>,

    #[account(
        mut,
        seeds = [b"profile", match_state.player_two.as_ref()],
        bump = profile_two.bump,
        constraint = profile_two.authority == match_state.player_two
            @ RoletError::ProfileMismatch,
    )]
    pub profile_two: Box<Account<'info, PlayerProfile>>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, GameVault>>,

    #[account(
        mut,
        token::mint = reward_mint,
        token::authority = vault,
    )]
    pub treasury_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = reward_mint,
        associated_token::authority = winner,
    )]
    pub winner_token_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: validated against match_state.winner via constraint
    #[account(
        constraint = match_state.winner == Some(winner.key())
            @ RoletError::WinnerMismatch,
    )]
    pub winner: UncheckedAccount<'info>,

    pub reward_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub rent_refund: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitPlayerProfile<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + PlayerProfile::INIT_SPACE,
        seeds = [b"profile", authority.key().as_ref()],
        bump,
    )]
    pub profile: Box<Account<'info, PlayerProfile>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterSessionKey<'info> {
    #[account(
        mut,
        seeds = [b"profile", authority.key().as_ref()],
        bump = profile.bump,
        constraint = profile.authority == authority.key() @ RoletError::ProfileMismatch,
    )]
    pub profile: Box<Account<'info, PlayerProfile>>,

    pub authority: Signer<'info>,
}

// PLAN_B: DelegateMatchState / UndelegateMatchState moved to client.

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct OpenLobby<'info> {
    #[account(
        init,
        payer = host,
        space = 8 + LobbyState::INIT_SPACE,
        seeds = [b"lobby", match_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub lobby: Account<'info, LobbyState>,
    #[account(mut)]
    pub host: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinLobby<'info> {
    #[account(
        mut,
        seeds = [b"lobby", lobby.match_id.to_le_bytes().as_ref()],
        bump = lobby.bump,
    )]
    pub lobby: Account<'info, LobbyState>,
    pub guest: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseLobby<'info> {
    #[account(
        mut,
        seeds = [b"lobby", lobby.match_id.to_le_bytes().as_ref()],
        bump = lobby.bump,
        has_one = host,
        close = host,
    )]
    pub lobby: Account<'info, LobbyState>,
    #[account(mut)]
    pub host: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + GameVault::INIT_SPACE,
        seeds = [b"vault"],
        bump,
    )]
    pub vault: Box<Account<'info, GameVault>>,

    pub reward_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = reward_mint,
        associated_token::authority = vault,
    )]
    pub treasury_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ============================================================
// Events
// ============================================================
#[event]
pub struct MatchInitialized {
    pub match_id: u64,
    pub seed: [u8; 32],
    pub first_turn: Pubkey,
}

#[event]
pub struct CardPlayed {
    pub actor: Pubkey,
    pub card: Card,
    pub detail: u64,
}

#[event]
pub struct TriggerPulled {
    pub actor: Pubkey,
    pub target: Pubkey,
    pub chamber: u8,
    pub damage: u8,
}

#[event]
pub struct MatchSettled {
    pub match_id: u64,
    pub winner: Pubkey,
    pub loser: Pubkey,
    pub reward: u64,
    pub p1_durability_remaining: u8,
    pub p2_durability_remaining: u8,
}

#[event]
pub struct ProfileCreated {
    pub authority: Pubkey,
    pub sns_domain: String,
    pub character_nft: Pubkey,
}

#[event]
pub struct VaultInitialized {
    pub authority: Pubkey,
    pub reward_mint: Pubkey,
    pub base_reward_per_match: u64,
}

#[event]
pub struct SessionKeyRegistered {
    pub authority: Pubkey,
    pub session_key: Pubkey,
    pub expires_at: i64,
}

#[event]
pub struct LobbyOpened {
    pub match_id: u64,
    pub host: Pubkey,
}

#[event]
pub struct LobbyReady {
    pub match_id: u64,
    pub host: Pubkey,
    pub guest: Pubkey,
}

// ============================================================
// Errors
// ============================================================
#[error_code]
pub enum RoletError {
    #[msg("Match is not in an active state")]
    MatchNotActive,
    #[msg("It is not your turn")]
    NotYourTurn,
    #[msg("Caller is not a participant in this match")]
    NotAParticipant,
    #[msg("Hand slot index is out of range")]
    InvalidSlot,
    #[msg("Selected hand slot is empty")]
    EmptySlot,
    #[msg("Card argument does not match the card held in slot")]
    CardMismatch,
    #[msg("Chamber index is out of range")]
    ChamberOutOfRange,
    #[msg("That chamber has already been fired")]
    ChamberAlreadyFired,
    #[msg("You are silenced and cannot play a card this turn")]
    SilencedThisTurn,
    #[msg("Reveal does not match the original commitment")]
    InvalidReveal,
    #[msg("Card effect not yet implemented in this build")]
    CardNotImplemented,
    #[msg("Match has not been finalized in the ER yet")]
    MatchNotCompleted,
    #[msg("Match is missing a recorded winner")]
    WinnerNotSet,
    #[msg("Provided profile does not match a participant of this match")]
    ProfileMismatch,
    #[msg("Winner pubkey does not match the recorded match winner")]
    WinnerMismatch,
    #[msg("Winner token account is owned by the wrong wallet")]
    WinnerAtaMismatch,
    #[msg("Winner token account is for the wrong reward mint")]
    RewardMintMismatch,
    #[msg("Treasury ATA does not match the vault's recorded treasury")]
    TreasuryMismatch,
    #[msg("Vault does not hold enough tokens to pay the reward")]
    InsufficientVault,
    #[msg("SNS domain string exceeds the 32-byte cap")]
    SnsDomainTooLong,
    #[msg("Durability max must be greater than zero")]
    InvalidDurability,
    #[msg("Signer is neither the wallet nor a valid (unexpired) session key")]
    UnauthorizedActor,
    #[msg("Session duration must be 1 second to 24 hours")]
    InvalidSessionDuration,
    #[msg("RestoreBullet has no spent chamber to refill")]
    NoChamberToRestore,
    #[msg("CardThief found no card to steal or no slot to receive it")]
    CardThiefNoTarget,
    #[msg("RandomInsight found no unfired chamber to reveal")]
    NoUnfiredChambers,
    #[msg("LastChance is only playable when at exactly 1 HP")]
    LastChanceRequiresOneHp,
    #[msg("Lobby already has a guest")]
    LobbyFull,
    #[msg("Host cannot join their own lobby")]
    CannotSelfMatch,
}
