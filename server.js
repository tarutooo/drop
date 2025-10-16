const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { randomUUID } = require('crypto');

const app = express();
app.use(express.static(__dirname));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// rooms: Map<string, Map<clientId, { ws, name }>>
const rooms = new Map();

wss.on('connection', (ws) => {
  const id = randomUUID();
  ws.id = id;

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      handleMessage(ws, data);
    } catch (e) {
      console.error('Invalid message', e);
    }
  });

  ws.on('close', () => {
    leave(ws);
  });

  // inform client of assigned id
  ws.send(JSON.stringify({ type: 'connected', id }));
});

function handleMessage(ws, data) {
  switch (data.type) {
    case 'join':
      joinRoom(ws, data.room, data.name);
      break;
    case 'offer':
    case 'answer':
    case 'ice':
    case 'chat':
      forwardToRoom(ws, data);
      break;
    default:
      // unknown
      break;
  }
}

function joinRoom(ws, room, name) {
  ws.room = room;
  ws.name = name || 'Anonymous';
  if (!rooms.has(room)) rooms.set(room, new Map());
  const map = rooms.get(room);

  // send existing peers to the joining client
  const peers = [];
  for (const [peerId, meta] of map.entries()) {
    peers.push({ id: peerId, name: meta.name });
  }

  // notify existing peers about the new client
  for (const [peerId, meta] of map.entries()) {
    try {
      meta.ws.send(JSON.stringify({ type: 'new-peer', id: ws.id, name: ws.name }));
    } catch (e) {}
  }

  map.set(ws.id, { ws, name: ws.name });

  ws.send(JSON.stringify({ type: 'init', id: ws.id, peers }));
}

function forwardToRoom(ws, data) {
  const room = ws.room;
  if (!room) return;
  const map = rooms.get(room);
  if (!map) return;

  if (data.to) {
    const target = map.get(data.to);
    if (target) {
      try {
        target.ws.send(JSON.stringify(Object.assign({}, data, { from: ws.id, name: ws.name })));
      } catch (e) {}
    }
    return;
  }

  // broadcast to all except sender
  for (const [peerId, meta] of map.entries()) {
    if (peerId === ws.id) continue;
    try {
      meta.ws.send(JSON.stringify(Object.assign({}, data, { from: ws.id, name: ws.name })));
    } catch (e) {}
  }
}

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  const map = rooms.get(room);
  if (!map) return;

  map.delete(ws.id);

  for (const [peerId, meta] of map.entries()) {
    try {
      meta.ws.send(JSON.stringify({ type: 'peer-left', id: ws.id }));
    } catch (e) {}
  }

  if (map.size === 0) rooms.delete(room);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
