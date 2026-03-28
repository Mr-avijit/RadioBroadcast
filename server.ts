import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';

async function startServer() {
  const app = express();
  const PORT = 3000;

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
    },
  });

  const frequencies = new Map<string, { broadcasterId: string, description: string, passcode: string }>();

  // Socket.IO logic
  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('check-frequency', (frequency, callback) => {
      const freqData = frequencies.get(frequency);
      if (freqData) {
        callback({ exists: true, description: freqData.description });
      } else {
        callback({ exists: false });
      }
    });

    socket.on('join-frequency', ({ frequency, role, description, passcode }, callback) => {
      if (role === 'broadcaster') {
        if (frequencies.has(frequency)) {
          return callback({ success: false, error: 'Frequency already in use.' });
        }
        frequencies.set(frequency, { broadcasterId: socket.id, description: description || '', passcode });
        socket.join(frequency);
        callback({ success: true });
        console.log(`Broadcaster ${socket.id} created frequency ${frequency}`);
      } else if (role === 'receiver') {
        const freqData = frequencies.get(frequency);
        if (!freqData) {
          return callback({ success: false, error: 'Frequency not found or broadcast ended.' });
        }
        if (freqData.passcode !== passcode) {
          return callback({ success: false, error: 'Invalid passcode. Access denied.' });
        }
        socket.join(frequency);
        socket.to(frequency).emit('user-joined', { id: socket.id, role });
        callback({ success: true });
        console.log(`Receiver ${socket.id} joined frequency ${frequency}`);
      }
    });

    socket.on('signal', (data) => {
      // Relay WebRTC signaling data
      io.to(data.to).emit('signal', {
        from: socket.id,
        signal: data.signal,
      });
    });

    socket.on('chat-message', (data) => {
      io.to(data.frequency).emit('chat-message', {
        id: Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9),
        from: socket.id,
        text: data.text,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      for (const [freq, data] of frequencies.entries()) {
        if (data.broadcasterId === socket.id) {
          frequencies.delete(freq);
          io.to(freq).emit('broadcast-ended');
          console.log(`Broadcast ${freq} ended because broadcaster disconnected.`);
          break;
        }
      }
    });
  });

  // API routes FIRST
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
