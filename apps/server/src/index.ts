import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import type { ServerToClientEvents, ClientToServerEvents } from '@rolet/shared';
import { registerHandlers } from './events/socketHandlers';

const app = express();
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok' }));

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: 'http://localhost:3000', methods: ['GET', 'POST'] },
});

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} bağlandı`);
  registerHandlers(io, socket);
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Rolet sunucu: http://localhost:${PORT}`);
});
