import type { GameState, PlayerId, CardId, PlayerState } from '@rolet/shared';
import { createGun, fireGun, isGunEmpty, ejectCurrentBullet, shuffleRemaining, addBulletAtEnd, moveLastBullet } from './BulletSystem';
import { dealHands, kaderinEliEffect, CARD_DEFINITIONS } from './CardSystem';

const ROUND_HP_BONUS: Record<number, number> = { 1: 0, 2: 2, 3: 1, 4: 0 };
const BASE_HP = 3;

export function createGame(roomId: string, p1Id: string, p1Name: string, p2Id: string, p2Name: string): GameState {
  const { hand1, hand2 } = dealHands();
  const firstTurn: PlayerId = Math.random() < 0.5 ? 'player1' : 'player2';

  return {
    roomId,
    phase: 'playing',
    currentTurn: firstTurn,
    round: 1,
    gun: createGun(5, 3),
    players: {
      player1: { id: p1Id, username: p1Name, hp: BASE_HP, maxHp: BASE_HP, hand: hand1, isSilenced: false, isSkipped: false },
      player2: { id: p2Id, username: p2Name, hp: BASE_HP, maxHp: BASE_HP, hand: hand2, isSilenced: false, isSkipped: false },
    },
    winner: null,
    lastAction: null,
  };
}

export function playCard(state: GameState, cardId: CardId): { state: GameState; message: string; reveal?: { bulletIndex: number; type: 'live' | 'blank' } } {
  const actor = state.currentTurn;
  const opponent: PlayerId = actor === 'player1' ? 'player2' : 'player1';
  let s = deepClone(state);
  let message = '';
  let reveal: { bulletIndex: number; type: 'live' | 'blank' } | undefined;

  // Kart elde var mı kontrol et
  const cardIndex = s.players[actor].hand.findIndex(c => c.id === cardId);
  if (cardIndex === -1) return { state, message: 'Kart elde yok.' };

  // Kartı elden çıkar
  s.players[actor].hand.splice(cardIndex, 1);

  switch (cardId) {
    case 'geri_ekleme': {
      s.gun = addBulletAtEnd(s.gun, 'live');
      message = 'Mermi silaha geri eklendi.';
      break;
    }
    case 'keskin_bakis': {
      const next = s.gun.bullets[s.gun.currentIndex];
      reveal = { bulletIndex: s.gun.currentIndex, type: next };
      message = `Sıradaki mermi: ${next === 'live' ? 'DOLU' : 'BOŞ'}`;
      break;
    }
    case 'sessizlik': {
      s.players[opponent].isSilenced = true;
      message = `${s.players[opponent].username} 1 tur kart oynayamaz.`;
      break;
    }
    case 'durdurucu': {
      s.players[opponent].isSkipped = true;
      message = `${s.players[opponent].username} 1 tur pas geçecek.`;
      break;
    }
    case 'mermi_cikarici': {
      s.gun = ejectCurrentBullet(s.gun);
      message = 'Sıradaki mermi çıkarıldı.';
      break;
    }
    case 'karistirici': {
      s.gun = shuffleRemaining(s.gun);
      message = 'Mermiler karıştırıldı.';
      break;
    }
    case 'cifte_darbe': {
      s.gun = { ...s.gun, damageMultiplier: 2 };
      message = 'Sonraki ateş 2 kat hasar verir!';
      break;
    }
    case 'can_yenileyici': {
      const p = s.players[actor];
      p.hp = Math.min(p.hp + 1, p.maxHp);
      message = '+1 can kazandın.';
      break;
    }
    case 'kart_hirsizi': {
      const oppHand = s.players[opponent].hand;
      if (oppHand.length > 0) {
        const stolen = oppHand.splice(Math.floor(Math.random() * oppHand.length), 1)[0];
        s.players[actor].hand.push(stolen);
        message = `"${stolen.name}" kartı çalındı.`;
      } else {
        message = 'Rakibin eli boş.';
      }
      break;
    }
    case 'rastgele_bilgi': {
      const remaining = s.gun.bullets.slice(s.gun.currentIndex);
      if (remaining.length > 0) {
        const idx = Math.floor(Math.random() * remaining.length);
        reveal = { bulletIndex: s.gun.currentIndex + idx, type: remaining[idx] };
        message = `${idx + 1}. mermi: ${remaining[idx] === 'live' ? 'DOLU' : 'BOŞ'}`;
      }
      break;
    }
    case 'son_sans': {
      s.gun = moveLastBullet(s.gun);
      message = 'Son merminin yeri değiştirildi.';
      break;
    }
    case 'kaderin_eli': {
      const effect = kaderinEliEffect();
      const p = s.players[actor];
      if (effect.hpDelta === 999) {
        p.hp = p.maxHp;
      } else {
        p.hp = Math.max(0, Math.min(p.maxHp, p.hp + effect.hpDelta));
      }
      message = effect.description;
      break;
    }
  }

  s.lastAction = message;
  s = checkDeath(s);
  return { state: s, message, reveal };
}

export function fireWeapon(state: GameState): { state: GameState; result: 'live' | 'blank'; damage: number } {
  let s = deepClone(state);
  const actor = s.currentTurn;
  const opponent: PlayerId = actor === 'player1' ? 'player2' : 'player1';

  const { type, gun } = fireGun(s.gun);
  s.gun = gun;

  let damage = 0;
  if (type === 'live') {
    damage = s.gun.damageMultiplier;
    s.players[opponent].hp = Math.max(0, s.players[opponent].hp - damage);
  }

  s.gun = { ...s.gun, damageMultiplier: 1 };
  s.lastAction = type === 'live' ? `Ateş! ${damage} hasar verildi.` : 'Boş mermi. Tık!';

  s = checkDeath(s);

  if (s.phase === 'playing') {
    if (isGunEmpty(s.gun)) {
      s = startNewRound(s);
    } else {
      s = nextTurn(s);
    }
  }

  return { state: s, result: type, damage };
}

function startNewRound(state: GameState): GameState {
  const nextRound = (state.round + 1) as 1 | 2 | 3 | 4;
  if (nextRound > 4) {
    return { ...state, phase: 'ended', winner: 'draw' };
  }

  const bonus = ROUND_HP_BONUS[nextRound];
  const { hand1, hand2 } = dealHands();

  const p1 = state.players.player1;
  const p2 = state.players.player2;
  const newMaxHp1 = p1.maxHp + bonus;
  const newMaxHp2 = p2.maxHp + bonus;

  return {
    ...state,
    round: nextRound,
    gun: createGun(5, 3),
    players: {
      player1: { ...p1, maxHp: newMaxHp1, hp: Math.min(p1.hp + bonus, newMaxHp1), hand: hand1, isSilenced: false, isSkipped: false },
      player2: { ...p2, maxHp: newMaxHp2, hp: Math.min(p2.hp + bonus, newMaxHp2), hand: hand2, isSilenced: false, isSkipped: false },
    },
    lastAction: `Raunt ${nextRound} başladı!`,
  };
}

function nextTurn(state: GameState): GameState {
  const next: PlayerId = state.currentTurn === 'player1' ? 'player2' : 'player1';
  let s = { ...state, currentTurn: next };

  // Sessizlik ve durdurucu sıfırla
  s.players[state.currentTurn] = { ...s.players[state.currentTurn], isSilenced: false };

  if (s.players[next].isSkipped) {
    s.players[next] = { ...s.players[next], isSkipped: false };
    s.lastAction = `${s.players[next].username} pas geçti.`;
    return nextTurn(s);
  }

  return s;
}

function checkDeath(state: GameState): GameState {
  if (state.players.player1.hp <= 0) {
    return { ...state, phase: 'ended', winner: 'player2' };
  }
  if (state.players.player2.hp <= 0) {
    return { ...state, phase: 'ended', winner: 'player1' };
  }
  return state;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
