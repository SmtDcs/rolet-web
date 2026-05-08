import { Server, Socket } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents } from '@rolet/shared';
import { createRoom, joinRoom, startGame, getRoom, getRoomBySocket, removePlayer } from '../rooms/RoomManager';
import { playCard, fireWeapon } from '../game/GameEngine';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function registerHandlers(io: Server<ClientToServerEvents, ServerToClientEvents>, socket: AppSocket) {
  const username = (socket.handshake.query.username as string) || `Player_${socket.id.slice(0, 4)}`;

  socket.on('room:create', () => {
    const room = createRoom(socket.id, username);
    socket.join(room.id);
    socket.emit('room:created', { roomId: room.id });
  });

  socket.on('room:join', ({ roomId }) => {
    const room = joinRoom(roomId, socket.id, username);
    if (!room) {
      socket.emit('error', { code: 'ROOM_NOT_FOUND', message: 'Oda bulunamadı veya dolu.' });
      return;
    }
    socket.join(room.id);
    socket.emit('room:joined', { roomId: room.id });

    if (room.players.length === 2) {
      const state = startGame(room.id);
      if (state) io.to(room.id).emit('game:start', { state });
    }
  });

  socket.on('card:play', ({ cardId }) => {
    const room = getRoomBySocket(socket.id);
    if (!room?.state || room.state.phase !== 'playing') return;

    const playerSlot = room.players.find(p => p.socketId === socket.id);
    if (!playerSlot || room.state.currentTurn !== playerSlot.playerId) return;

    const player = room.state.players[playerSlot.playerId];
    if (player.isSilenced) {
      socket.emit('error', { code: 'SILENCED', message: 'Bu tur kart oynayamazsın.' });
      return;
    }

    const { state, message, reveal } = playCard(room.state, cardId);
    room.state = state;

    io.to(room.id).emit('game:card_effect', { card: cardId, playedBy: playerSlot.playerId, message });
    if (reveal) io.to(room.id).emit('game:reveal', reveal);
    io.to(room.id).emit('game:state', { state });

    if (state.phase === 'ended') {
      io.to(room.id).emit('game:end', { winner: state.winner!, state });
    }
  });

  socket.on('gun:fire', () => {
    const room = getRoomBySocket(socket.id);
    if (!room?.state || room.state.phase !== 'playing') return;

    const playerSlot = room.players.find(p => p.socketId === socket.id);
    if (!playerSlot || room.state.currentTurn !== playerSlot.playerId) return;

    const { state, result, damage } = fireWeapon(room.state);
    room.state = state;

    io.to(room.id).emit('game:reveal', { bulletIndex: state.gun.currentIndex - 1, type: result });
    io.to(room.id).emit('game:state', { state });

    if (state.phase === 'ended') {
      io.to(room.id).emit('game:end', { winner: state.winner!, state });
    }
  });

  socket.on('disconnect', () => {
    const room = removePlayer(socket.id);
    if (room && room.state?.phase === 'playing') {
      const remaining = room.players[0];
      if (remaining) {
        const winner = remaining.playerId;
        io.to(room.id).emit('game:end', {
          winner,
          state: { ...room.state, phase: 'ended', winner },
        });
      }
    }
  });
}
