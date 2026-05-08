import type { GameState, CardId, PlayerId, CardReveal } from './game';

export interface ServerToClientEvents {
  'room:created': (data: { roomId: string }) => void;
  'room:joined': (data: { roomId: string }) => void;
  'game:start': (data: { state: GameState }) => void;
  'game:state': (data: { state: GameState }) => void;
  'game:card_effect': (data: { card: CardId; playedBy: PlayerId; message: string }) => void;
  'game:reveal': (data: CardReveal) => void;
  'game:end': (data: { winner: PlayerId | 'draw'; state: GameState }) => void;
  error: (data: { code: string; message: string }) => void;
}

export interface ClientToServerEvents {
  'room:create': () => void;
  'room:join': (data: { roomId: string }) => void;
  'queue:join': (data: { mode: 'unranked' | 'ranked' }) => void;
  'game:ready': () => void;
  'card:play': (data: { cardId: CardId }) => void;
  'gun:fire': () => void;
}
