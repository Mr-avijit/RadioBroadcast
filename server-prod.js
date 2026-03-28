const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const PORT = process.env.PORT || 3000;

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const frequencies = new Map();

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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
