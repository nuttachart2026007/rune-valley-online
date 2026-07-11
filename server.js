// ============================================================
// RUNE VALLEY ONLINE - Game Server
// Pixel-art multiplayer RPG (Ragnarok Online 2002 inspired)
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const TILE = 32;

// ---------------- MAP ----------------
// legend: . grass | t tree | w water | p path | s stone wall | f flower | d sand
const MAP_STR = [
"ttttttttttttttttttttttttttttttttttttttttttttttttttt",
"t.................t......................t........t",
"t..f...........................f..............f...t",
"t......ssssssssssss..........................t....t",
"t......s..........s.....t........t.antml..........t..t",
"t......s..........s............................t..t",
"t......s....p.....s......f...........t............t",
"t......s....p.....s................................t",
"t......ssssppssssss.......t..............f........t",
"t...........pp....................................t",
"t...f.......pp..........t.....t...............t...t",
"t...........pp....................................t",
"t....t......pppppppppppppppppppppppppppppp........t",
"t..........................t.............p....f...t",
"t...............f........................p........t",
"t.....t..................................p........t",
"t.........wwwww..........................p........t",
"t........wwwwwww....t............t.......p........t",
"t........wwwwwww.........................p........t",
"t.....dddwwwwwwwdd.......................p........t",
"t.....d..wwwww...d............f..........p........t",
"t.....d..........d........................p.......t",
"t.....ddddddddddId.....t..................p.......t",
"t..........................................p......t",
"t...f...........t...........t..............p......t",
"t..........................................p......t",
"t...........t.....................f........p......t",
"t..................t.......................p......t",
"t.......t..........................t.......p......t",
"t..................................................t",
"t......f..............t...........................t",
"t...........t..............f..........t...........t",
"tttttttttttttttttttttttttttttttttttttttttttttttttttt"
];
// sanitize map rows to equal width, fix accidental chars
const MAP_W = 52, MAP_H = MAP_STR.length;
const LEGAL = new Set(['.','t','w','p','s','f','d']);
const MAP = MAP_STR.map(row => {
  let r = row.split('').map(c => LEGAL.has(c) ? c : '.');
  while (r.length < MAP_W) r.push('t');
  return r.slice(0, MAP_W);
});
const BLOCKED = new Set(['t','w','s']);

function isBlocked(px, py) {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  return BLOCKED.has(MAP[ty][tx]);
}

// Town spawn point (inside stone-walled town, near path)
const SPAWN = { x: 13 * TILE, y: 7 * TILE };

// ---------------- CLASSES ----------------
const CLASSES = {
  swordsman: { hp: 120, atk: 10, range: 48,  cooldown: 500,  speed: 3.0 },
  archer:    { hp: 90,  atk: 8,  range: 150, cooldown: 650,  speed: 3.2 },
  mage:      { hp: 80,  atk: 12, range: 170, cooldown: 900,  speed: 2.9 }
};

// ---------------- MONSTERS ----------------
const MONSTER_TYPES = {
  jelly:     { name: 'Jelly',      hp: 30,  atk: 3,  xp: 8,   zeny: 5,  speed: 0.8, aggro: 0,   lvl: 1 },
  bluejelly: { name: 'Blue Jelly', hp: 60,  atk: 6,  xp: 18,  zeny: 12, speed: 1.0, aggro: 90,  lvl: 3 },
  mushy:     { name: 'Mushy',      hp: 110, atk: 10, xp: 35,  zeny: 25, speed: 0.7, aggro: 100, lvl: 6 },
  wolf:      { name: 'Dire Wolf',  hp: 220, atk: 16, xp: 80,  zeny: 60, speed: 1.6, aggro: 140, lvl: 10 }
};
// spawn zones: [type, count, x1,y1,x2,y2] in tiles (outside town)
const SPAWN_ZONES = [
  ['jelly',     8, 20, 2,  48, 10],
  ['jelly',     4, 2,  24, 18, 30],
  ['bluejelly', 5, 20, 13, 40, 20],
  ['mushy',     4, 25, 23, 48, 30],
  ['wolf',      2, 40, 24, 49, 30]
];

let nextMonsterId = 1;
const monsters = {};

function randPointInZone(z) {
  for (let i = 0; i < 50; i++) {
    const x = (z[2] + Math.random() * (z[4] - z[2])) * TILE;
    const y = (z[3] + Math.random() * (z[5] - z[3])) * TILE;
    if (!isBlocked(x, y)) return { x, y };
  }
  return { x: z[2] * TILE, y: z[3] * TILE };
}

function spawnMonster(type, zone) {
  const t = MONSTER_TYPES[type];
  const p = randPointInZone(zone);
  const id = 'm' + (nextMonsterId++);
  monsters[id] = {
    id, type, x: p.x, y: p.y, hp: t.hp, maxHp: t.hp,
    homeX: p.x, homeY: p.y, target: null, zone,
    lastAtk: 0, dead: false, respawnAt: 0, wanderAt: 0, vx: 0, vy: 0
  };
}
SPAWN_ZONES.forEach(z => { for (let i = 0; i < z[1]; i++) spawnMonster(z[0], z); });

// ---------------- PLAYERS ----------------
const players = {}; // id -> player
let nextPlayerId = 1;

function makePlayer(ws, name, cls) {
  const c = CLASSES[cls] || CLASSES.swordsman;
  const id = 'p' + (nextPlayerId++);
  return {
    id, ws, name, cls,
    x: SPAWN.x + (Math.random() * 60 - 30), y: SPAWN.y + (Math.random() * 60 - 30),
    dir: 'down', moving: false,
    hp: c.hp, maxHp: c.hp, atk: c.atk,
    level: 1, xp: 0, zeny: 0,
    lastAtk: 0, dead: false, respawnAt: 0, lastMoveMsg: Date.now()
  };
}

function xpNeeded(level) { return Math.floor(20 * Math.pow(level, 1.6)); }

function grantXp(p, amount) {
  p.xp += amount;
  while (p.xp >= xpNeeded(p.level)) {
    p.xp -= xpNeeded(p.level);
    p.level++;
    p.maxHp += 15;
    p.atk += 2;
    p.hp = p.maxHp;
    broadcast({ t: 'event', kind: 'levelup', id: p.id, level: p.level });
  }
}

// ---------------- NETWORK ----------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let file = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const safe = path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
  const candidates = [path.join(__dirname, 'public', safe), path.join(__dirname, safe)];
  const tryRead = (i) => {
    if (i >= candidates.length) { res.writeHead(404); res.end('Not found'); return; }
    fs.readFile(candidates[i], (err, data) => {
      if (err) { tryRead(i + 1); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(candidates[i])] || 'application/octet-stream' });
      res.end(data);
    });
  };
  tryRead(0);
});
const wss = new WebSocketServer({ server });

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(obj) { const s = JSON.stringify(obj); for (const id in players) { const ws = players[id].ws; if (ws.readyState === 1) ws.send(s); } }

function cleanName(raw) {
  let n = String(raw || '').replace(/[^\w\- ]/g, '').trim().slice(0, 12);
  return n.length ? n : 'Novice' + Math.floor(Math.random() * 999);
}

wss.on('connection', (ws) => {
  let me = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'join' && !me) {
      const cls = CLASSES[msg.cls] ? msg.cls : 'swordsman';
      me = makePlayer(ws, cleanName(msg.name), cls);
      players[me.id] = me;
      send(ws, {
        t: 'init', id: me.id, map: MAP.map(r => r.join('')), tile: TILE,
        you: publicPlayer(me)
      });
      broadcast({ t: 'event', kind: 'join', name: me.name, id: me.id });
      console.log(`[join] ${me.name} (${me.cls}) - ${Object.keys(players).length} online`);
      return;
    }
    if (!me || me.dead) {
      if (me && msg.t === 'chat') handleChat(me, msg);
      return;
    }

    if (msg.t === 'move') {
      const c = CLASSES[me.cls];
      const now = Date.now();
      const dt = Math.min(now - me.lastMoveMsg, 400);
      me.lastMoveMsg = now;
      const maxDist = c.speed * (dt / 16) + 12; // speed clamp (anti-teleport)
      const nx = Number(msg.x), ny = Number(msg.y);
      if (!isFinite(nx) || !isFinite(ny)) return;
      const dx = nx - me.x, dy = ny - me.y;
      const dist = Math.hypot(dx, dy);
      let tx = nx, ty = ny;
      if (dist > maxDist) { tx = me.x + dx / dist * maxDist; ty = me.y + dy / dist * maxDist; }
      if (!isBlocked(tx, ty)) { me.x = tx; me.y = ty; }
      me.dir = ['up', 'down', 'left', 'right'].includes(msg.dir) ? msg.dir : me.dir;
      me.moving = !!msg.moving;
      return;
    }

    if (msg.t === 'attack') {
      const c = CLASSES[me.cls];
      const now = Date.now();
      if (now - me.lastAtk < c.cooldown) return;
      me.lastAtk = now;
      // find nearest living monster in range
      let best = null, bestD = Infinity;
      for (const id in monsters) {
        const m = monsters[id];
        if (m.dead) continue;
        const d = Math.hypot(m.x - me.x, m.y - me.y);
        if (d < bestD) { bestD = d; best = m; }
      }
      broadcast({ t: 'event', kind: 'swing', id: me.id, cls: me.cls, dir: me.dir });
      if (best && bestD <= c.range + 16) {
        const dmg = Math.max(1, Math.floor(me.atk + me.level * 1.5 + Math.random() * 6 - 2));
        best.hp -= dmg;
        best.target = me.id;
        broadcast({ t: 'event', kind: 'hit', from: me.id, target: best.id, dmg, tx: best.x, ty: best.y, cls: me.cls });
        if (best.hp <= 0) killMonster(best, me);
      }
      return;
    }

    if (msg.t === 'chat') { handleChat(me, msg); return; }
  });

  ws.on('close', () => {
    if (me && players[me.id]) {
      broadcast({ t: 'event', kind: 'leave', name: me.name, id: me.id });
      delete players[me.id];
      console.log(`[leave] ${me.name} - ${Object.keys(players).length} online`);
    }
  });
});

function handleChat(p, msg) {
  const text = String(msg.text || '').slice(0, 120).trim();
  if (!text) return;
  broadcast({ t: 'event', kind: 'chat', id: p.id, name: p.name, text });
}

function killMonster(m, killer) {
  const t = MONSTER_TYPES[m.type];
  m.dead = true;
  m.respawnAt = Date.now() + 8000 + Math.random() * 7000;
  killer.zeny += t.zeny + Math.floor(Math.random() * t.zeny);
  broadcast({ t: 'event', kind: 'mdeath', id: m.id, x: m.x, y: m.y, killer: killer.id, zeny: t.zeny });
  grantXp(killer, t.xp);
}

function killPlayer(p, m) {
  p.dead = true;
  p.respawnAt = Date.now() + 3000;
  p.moving = false;
  broadcast({ t: 'event', kind: 'pdeath', id: p.id, by: MONSTER_TYPES[m.type].name });
}

// ---------------- GAME LOOP (10 Hz) ----------------
setInterval(() => {
  const now = Date.now();

  // monsters AI
  for (const id in monsters) {
    const m = monsters[id];
    const t = MONSTER_TYPES[m.type];
    if (m.dead) {
      if (now >= m.respawnAt) {
        const p = randPointInZone(m.zone);
        m.x = p.x; m.y = p.y; m.homeX = p.x; m.homeY = p.y;
        m.hp = t.hp; m.dead = false; m.target = null;
      }
      continue;
    }
    // acquire target if aggressive
    let tgt = m.target ? players[m.target] : null;
    if (tgt && (tgt.dead || Math.hypot(tgt.x - m.x, tgt.y - m.y) > 320)) { tgt = null; m.target = null; }
    if (!tgt && t.aggro > 0) {
      for (const pid in players) {
        const p = players[pid];
        if (p.dead) continue;
        if (Math.hypot(p.x - m.x, p.y - m.y) < t.aggro) { m.target = pid; tgt = p; break; }
      }
    }
    if (tgt) {
      const dx = tgt.x - m.x, dy = tgt.y - m.y;
      const d = Math.hypot(dx, dy);
      if (d > 28) {
        const nx = m.x + dx / d * t.speed * 3, ny = m.y + dy / d * t.speed * 3;
        if (!isBlocked(nx, ny)) { m.x = nx; m.y = ny; }
      } else if (now - m.lastAtk > 1200) {
        m.lastAtk = now;
        const dmg = Math.max(1, t.atk + Math.floor(Math.random() * 4) - 1);
        tgt.hp -= dmg;
        broadcast({ t: 'event', kind: 'phit', target: tgt.id, from: m.id, dmg });
        if (tgt.hp <= 0) killPlayer(tgt, m);
      }
    } else {
      // wander near home
      if (now > m.wanderAt) {
        m.wanderAt = now + 2000 + Math.random() * 3000;
        const a = Math.random() * Math.PI * 2;
        m.vx = Math.cos(a) * t.speed * 2; m.vy = Math.sin(a) * t.speed * 2;
        if (Math.random() < 0.4) { m.vx = 0; m.vy = 0; }
      }
      const nx = m.x + m.vx, ny = m.y + m.vy;
      if (!isBlocked(nx, ny) && Math.hypot(nx - m.homeX, ny - m.homeY) < 160) { m.x = nx; m.y = ny; }
      else { m.vx = -m.vx; m.vy = -m.vy; }
    }
  }

  // players: respawn + regen
  for (const id in players) {
    const p = players[id];
    if (p.dead && now >= p.respawnAt) {
      p.dead = false;
      p.hp = p.maxHp;
      p.x = SPAWN.x; p.y = SPAWN.y;
      broadcast({ t: 'event', kind: 'respawn', id: p.id });
    }
    if (!p.dead && p.hp < p.maxHp && now % 3000 < 120) p.hp = Math.min(p.maxHp, p.hp + 2 + Math.floor(p.level / 2));
  }

  // broadcast state
  const state = {
    t: 's',
    p: Object.values(players).map(publicPlayer),
    m: Object.values(monsters).filter(m => !m.dead).map(m => ({
      id: m.id, ty: m.type, x: Math.round(m.x), y: Math.round(m.y), hp: m.hp, mh: m.maxHp, tg: !!m.target
    }))
  };
  broadcast(state);
}, 100);

function publicPlayer(p) {
  return {
    id: p.id, n: p.name, c: p.cls, x: Math.round(p.x), y: Math.round(p.y),
    d: p.dir, mv: p.moving, hp: p.hp, mh: p.maxHp, lv: p.level,
    xp: p.xp, xn: xpNeeded(p.level), z: p.zeny, dead: p.dead
  };
}

server.listen(PORT, () => {
  console.log('=========================================');
  console.log('  RUNE VALLEY ONLINE - server started');
  console.log(`  Local play:  http://localhost:${PORT}`);
  console.log('=========================================');
});
