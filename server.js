'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  fs.readFile(path.join(__dirname, 'street-brawler.html'), (err, data) => {
    if (err) { res.writeHead(500); res.end('error'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
let waiting = null;

wss.on('connection', ws => {
  ws.room = null;

  if (waiting) {
    const other = waiting;
    waiting = null;
    ws.room = other.room = [other, ws];
    other.send(JSON.stringify({ type: 'start', player: 1 }));
    ws.send(JSON.stringify({ type: 'start', player: 2 }));
  } else {
    waiting = ws;
    ws.send(JSON.stringify({ type: 'wait' }));
  }

  ws.on('message', data => {
    if (!ws.room) return;
    const other = ws.room.find(p => p !== ws);
    if (other && other.readyState === 1) other.send(data.toString());
  });

  ws.on('close', () => {
    if (waiting === ws) { waiting = null; return; }
    if (ws.room) {
      const other = ws.room.find(p => p !== ws);
      if (other && other.readyState === 1)
        other.send(JSON.stringify({ type: 'disconnect' }));
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const addrs = Object.values(networkInterfaces()).flat()
    .filter(n => n.family === 'IPv4' && !n.internal)
    .map(n => `  http://${n.address}:${PORT}`);
  console.log('\n大乱闘ウエダファミリー — ネット対戦サーバー起動');
  console.log('='.repeat(46));
  addrs.forEach(a => console.log(a));
  console.log('='.repeat(46));
  console.log('同じWiFiの端末からURLにアクセスしてください\n');
});
