export type BulletType = 'live' | 'blank';
export type PlayerId = 'player1' | 'player2';
export type GamePhase = 'waiting' | 'playing' | 'ended';
export type CardId =
  | 'geri_ekleme'
  | 'keskin_bakis'
  | 'sessizlik'
  | 'durdurucu'
  | 'mermi_cikarici'
  | 'karistirici'
  | 'cifte_darbe'
  | 'can_yenileyici'
  | 'kart_hirsizi'
  | 'rastgele_bilgi'
  | 'son_sans'
  | 'kaderin_eli';

export interface Card {
  id: CardId;
  name: string;
  description: string;
}

export interface PlayerState {
  id: string;
  username: string;
  hp: number;
  maxHp: number;
  hand: Card[];
  isSilenced: boolean;
  isSkipped: boolean;
}

export interface GunState {
  bullets: BulletType[];
  currentIndex: number;
  damageMultiplier: 1 | 2;
}

export interface GameState {
  roomId: string;
  phase: GamePhase;
  currentTurn: PlayerId;
  round: 1 | 2 | 3 | 4;
  gun: GunState;
  players: {
    player1: PlayerState;
    player2: PlayerState;
  };
  winner: PlayerId | 'draw' | null;
  lastAction: string | null;
}

export interface CardReveal {
  bulletIndex: number;
  type: BulletType;
}
