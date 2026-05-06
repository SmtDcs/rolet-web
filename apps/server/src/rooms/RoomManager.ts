import type { GameState } from '@rolet/shared';
import { createGame } from '../game/GameEngine';

interface Room {
  id: string;
  players: { socketId: string; playerId: 'player1' | 'player2'; username: string }[];
  state: GameState | null;
}

const rooms = new Map<string, Room>();

export function createRoom(socketId: string, username: string): Room {
  const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
  const room: Room = {
    id: roomId,
    players: [{ socketId, playerId: 'player1', username }],
    state: null,
  };
  rooms.set(roomId, room);
  return room;
}

export function joinRoom(roomId: string, socketId: string, username: string): Room | null {
  const room = rooms.get(roomId);
  if (!room || room.players.length >= 2) return null;
  room.players.push({ socketId, playerId: 'player2', username });
  return room;
}

export function startGame(roomId: string): GameState | null {
  const room = rooms.get(roomId);
  if (!room || room.players.length < 2) return null;
  const [p1, p2] = room.players;
  room.state = createGame(roomId, p1.socketId, p1.username, p2.socketId, p2.username);
  return room.state;
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function getRoomBySocket(socketId: string): Room | undefined {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.socketId === socketId)) return room;
  }
}

export function removePlayer(socketId: string): Room | undefined {
  const room = getRoomBySocket(socketId);
  if (!room) return;
  room.players = room.players.filter(p => p.socketId !== socketId);
  if (room.players.length === 0) rooms.delete(room.id);
  return room;
}
