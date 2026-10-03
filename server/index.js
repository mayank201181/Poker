import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { RoomManager } from './rooms.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

export function createApp({ timing } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (req, res) => res.type('text').send('ok'));
  app.use(express.static(publicDir));
  // Share links look like https://…/ABCD
  app.get('/:code', (req, res, next) => {
    if (/^[A-Za-z]{4}$/.test(req.params.code)) res.sendFile(path.join(publicDir, 'index.html'));
    else next();
  });

  const server = createServer(app);
  const io = new Server(server, {
    pingInterval: 10_000,
    pingTimeout: 15_000,
    maxHttpBufferSize: 64 * 1024,
  });
  const rooms = new RoomManager({ timing });
  io.on('connection', (socket) => rooms.attach(socket));
  return { app, server, io, rooms };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server, io, rooms } = createApp();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`Poker is running on http://localhost:${port}`));
  const stop = () => {
    rooms.close();
    io.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
