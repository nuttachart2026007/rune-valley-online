// ============================================================
// RUNE VALLEY ONLINE - Game Server v2
// Pixel-art multiplayer RPG (Ragnarok Online 2002 inspired)
// v2: dungeon, boss, harder monsters, job skills, player saves
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const TILE = 32;
const SECRET = process.env.SAVE_SECRET || 'rune-valley-save-secret-v2';
const SAVE_FILE = path.join(__dirname, 'saves.json');

// ---------------- MAP ----------------
// legend: . grass | t tree | w water | p path | s stone wall | f flower | d sand | c cave floor
const MAP_STR = [
"ttttttttttttttttttttttttttttttttttttttttttttttttttt",
"t.................t......................t........t",
"t..f...........................f..............f...t",
"t......ssssssssssss..........................t....t",
"t......s..........s.....t........t................t",
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
"t.....dddddddddddd.....t..................p.......t",
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
const MAP_W = 52;
const LEGAL = new Set(['.','t','w','p','s','f','d','c']);
const MAP = MAP_STR.map(row => {
  let r = row.split('').map(ch => LEGAL.has(ch) ? ch : '.');
  while (r.length < MAP_W) r.push('t');
  return r.slice(0, MAP_W);
});
// ---- carve dungeon entrance + append dungeon (programmatic = always correct width) ----
MAP[MAP.length - 1][43] = 'c'; MAP[MAP.length - 1][44] = 'c';    // entrance in bottom tree row
MAP.push(('s'.repeat(43) + 'cc' + 's'.repeat(7)).split(''));      // corridor row
for (let i = 0; i < 10; i++) MAP.push(('s' + 'c'.repeat(50) + 's').split(''));
MAP.push('s'.repeat(52).split(''));                               // dungeon bottom wall
// pillars inside the cavern
[[10,36],[10,40],[20,38],[30,36],[30,41],[24,35]].forEach(([x,y]) => { MAP[y][x] = 's'; });
const MAP_H = MAP.length;
const BLOCKED = new Set(['t','w','s']);

function isBlocked(px, py) {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  return BLOCKED.has(MAP[ty][tx]);
}

const SPAWN = { x: 13 * TILE, y: 7 * TILE };

// ---------------- CLASSES & SKILLS ----------------
const CLASSES = {
  swordsman: { hp: 140, atk: 11, range: 48,  cooldown: 500,  speed: 3.0 },
  archer:    { hp: 100, atk: 9,  range: 150, cooldown: 650,  speed: 3.2 },
  mage:      { hp: 90,  atk: 13, range: 170, cooldown: 900,  speed: 2.9 }
};
// skill defs: unlock level, cooldown ms, behavior handled in useSkill()
const SKILLS = {
  swordsman: [
    { key: 'bash',      name: 'Bash',         lvl: 3,  cd: 4000 },
    { key: 'whirl',     name: 'Whirlwind',    lvl: 6,  cd: 8000 },
    { key: 'warcry',    name: 'War Cry',      lvl: 10, cd: 20000 }
  ],
  archer: [
    { key: 'dstrafe',   name: 'Double Strafe', lvl: 3,  cd: 4000 },
    { key: 'arrowrain', name: 'Arrow Rain',    lvl: 6,  cd: 9000 },
    { key: 'snipe',     name: 'Snipe',         lvl: 10, cd: 15000 }
  ],
  mage: [
    { key: 'firebolt',  name: 'Firebolt',     lvl: 3,  cd: 4000 },
    { key: 'frostnova', name: 'Frost Nova',   lvl: 6,  cd: 10000 },
    { key: 'meteor',    name: 'Meteor',       lvl: 10, cd: 18000 }
  ]
};

// ---------------- MONSTERS (v2: harder + aggressive) ----------------
const MONSTER_TYPES = {
  jelly:     { name: 'Jelly',       hp: 50,   atk: 5,  xp: 10,   zeny: 6,    speed: 0.8, aggro: 0,   lvl: 1  },
  bluejelly: { name: 'Blue Jelly',  hp: 120,  atk: 12, xp: 30,   zeny: 18,   speed: 1.1, aggro: 120, lvl: 4  },
  mushy:     { name: 'Mushy',       hp: 220,  atk: 20, xp: 60,   zeny: 40,   speed: 0.8, aggro: 140, lvl: 8  },
  wolf:      { name: 'Dire Wolf',   hp: 450,  atk: 30, xp: 150,  zeny: 90,   speed: 1.7, aggro: 180, lvl: 12 },
  skeleton:  { name: 'Skeleton',    hp: 650,  atk: 38, xp: 260,  zeny: 140,  speed: 1.4, aggro: 200, lvl: 16 },
  ghoul:     { name: 'Ghoul',       hp: 950,  atk: 48, xp: 420,  zeny: 220,  speed: 1.1, aggro: 220, lvl: 20 },
  direking:  { name: 'Gorehorn the Dire King', hp: 6000, atk: 70, xp: 3000, zeny: 2500, speed: 1.8, aggro: 280, lvl: 30, boss: true }
};
const SPAWN_ZONES = [
  ['jelly',     8, 20, 2,  48, 10],
  ['jelly',     4, 2,  24, 18, 30],
  ['bluejelly', 5, 20, 13, 40, 20],
  ['mushy',     4, 25, 23, 48, 30],
  ['wolf',      3, 30, 24, 49, 30],
  ['skeleton',  5, 3,  33, 25, 42],
  ['ghoul',     4, 26, 33, 48, 42],
  ['direking',  1, 34, 36, 46, 41]
];

let nextMonsterId = 1;
const monsters = {};

function randPointInZone(z) {
  for (let i = 0; i < 60; i++) {
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
    lastAtk: 0, lastStomp: 0, dead: false, respawnAt: 0, wanderAt: 0,
    slowUntil: 0, vx: 0, vy: 0
  };
  if (t.boss && bootDone) broadcast({ t: 'event', kind: 'boss', text: t.name + ' has awakened in the dungeon!' });
}
let bootDone = false;
SPAWN_ZONES.forEach(z => { for (let i = 0; i < z[1]; i++) spawnMonster(z[0], z); });
bootDone = true;

// ---------------- SAVES ----------------
let saves = {};   // nameLower -> {name, cls, level, xp, zeny, pinHash, seen}
let savesDirty = false;
try { saves = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')); console.log('[saves] loaded', Object.keys(saves).length, 'heroes'); } catch { saves = {}; }
setInterval(() => {
  if (!savesDirty) return;
  savesDirty = false;
  fs.writeFile(SAVE_FILE, JSON.stringify(saves), () => {});
}, 15000);

function hashPin(pin) { return crypto.createHash('sha256').update(String(pin) + '|' + SECRET).digest('hex'); }
function sign(data) { return crypto.createHmac('sha256', SECRET).update(data).digest('hex'); }
function makeToken(rec) {
  const data = Buffer.from(JSON.stringify(rec)).toString('base64url');
  return data + '.' + sign(data);
}
function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  if (sign(data) !== sig) return null;
  try { return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')); } catch { return null; }
}
function recordOf(p) {
  return { name: p.name, cls: p.cls, level: p.level, xp: p.xp, zeny: p.zeny, pinHash: p.pinHash, seen: Date.now() };
}
function persist(p) {
  saves[p.name.toLowerCase()] = recordOf(p);
  savesDirty = true;
}
function sendSave(p) {
  persist(p);
  send(p.ws, { t: 'save', name: p.name, token: makeToken(recordOf(p)) });
}

// ---------------- PLAYERS ----------------
const players = {};
let nextPlayerId = 1;

function statsForLevel(cls, level) {
  const c = CLASSES[cls] || CLASSES.swordsman;
  return { maxHp: c.hp + 15 * (level - 1), atk: c.atk + 2 * (level - 1) };
}

function makePlayer(ws, name, cls, pinHash, restore) {
  const id = 'p' + (nextPlayerId++);
  const level = restore ? restore.level : 1;
  const st = statsForLevel(cls, level);
  return {
    id, ws, name, cls, pinHash,
    x: SPAWN.x + (Math.random() * 60 - 30), y: SPAWN.y + (Math.random() * 60 - 30),
    dir: 'down', moving: false,
    hp: st.maxHp, maxHp: st.maxHp, atk: st.atk,
    level, xp: restore ? restore.xp : 0, zeny: restore ? restore.zeny : 0,
    lastAtk: 0, skillCd: [0, 0, 0], buffUntil: 0,
    dead: false, respawnAt: 0, lastMoveMsg: Date.now()
  };
}

function xpNeeded(level) { return Math.floor(20 * Math.pow(level, 1.6)); }

function grantXp(p, amount) {
  p.xp += amount;
  let leveled = false;
  while (p.xp >= xpNeeded(p.level)) {
    p.xp -= xpNeeded(p.level);
    p.level++;
    leveled = true;
    const st = statsForLevel(p.cls, p.level);
    p.maxHp = st.maxHp; p.atk = st.atk; p.hp = p.maxHp;
    broadcast({ t: 'event', kind: 'levelup', id: p.id, level: p.level });
  }
  if (leveled) sendSave(p);
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

function isBuffed(p) { return Date.now() < p.buffUntil; }
function baseDmg(p) { return p.atk + p.level * 1.5 + Math.random() * 6 - 2; }
function dmgRoll(p, mult) { return Math.max(1, Math.floor(baseDmg(p) * mult * (isBuffed(p) ? 1.6 : 1))); }

function hitMonster(p, m, dmg) {
  m.hp -= dmg;
  m.target = p.id;
  broadcast({ t: 'event', kind: 'hit', from: p.id, target: m.id, dmg, tx: m.x, ty: m.y, cls: p.cls });
  if (m.hp <= 0) killMonster(m, p);
}

function monstersInRange(x, y, r) {
  const out = [];
  for (const id in monsters) {
    const m = monsters[id];
    if (!m.dead && Math.hypot(m.x - x, m.y - y) <= r) out.push(m);
  }
  return out;
}
function nearestMonster(x, y, maxR) {
  let best = null, bd = Infinity;
  for (const id in monsters) {
    const m = monsters[id];
    if (m.dead) continue;
    const d = Math.hypot(m.x - x, m.y - y);
    if (d < bd) { bd = d; best = m; }
  }
  return (best && bd <= maxR) ? best : null;
}

function useSkill(p, n) {
  const defs = SKILLS[p.cls];
  if (!defs || n < 0 || n > 2) return;
  const def = defs[n];
  const now = Date.now();
  if (p.level < def.lvl) return;
  if (now < p.skillCd[n]) return;
  const c = CLASSES[p.cls];

  let fx = { t: 'event', kind: 'skillfx', id: p.id, skill: def.key, x: Math.round(p.x), y: Math.round(p.y) };
  let used = false;

  if (def.key === 'bash') {
    const m = nearestMonster(p.x, p.y, c.range + 16);
    if (m) { fx.x = Math.round(m.x); fx.y = Math.round(m.y); hitMonster(p, m, dmgRoll(p, 3)); used = true; }
  } else if (def.key === 'whirl') {
    const list = monstersInRange(p.x, p.y, 90);
    if (list.length) { list.forEach(m => hitMonster(p, m, dmgRoll(p, 2))); used = true; }
  } else if (def.key === 'warcry') {
    p.buffUntil = now + 8000;
    used = true;
  } else if (def.key === 'dstrafe') {
    const m = nearestMonster(p.x, p.y, c.range + 16);
    if (m) { fx.x = Math.round(m.x); fx.y = Math.round(m.y); hitMonster(p, m, dmgRoll(p, 1.5)); if (!m.dead) hitMonster(p, m, dmgRoll(p, 1.5)); used = true; }
  } else if (def.key === 'arrowrain') {
    const m = nearestMonster(p.x, p.y, c.range + 40);
    const cx0 = m ? m.x : p.x, cy0 = m ? m.y : p.y;
    const list = monstersInRange(cx0, cy0, 95);
    fx.x = Math.round(cx0); fx.y = Math.round(cy0);
    if (list.length) { list.forEach(mm => hitMonster(p, mm, dmgRoll(p, 1.5))); used = true; }
  } else if (def.key === 'snipe') {
    const m = nearestMonster(p.x, p.y, 270);
    if (m) { fx.x = Math.round(m.x); fx.y = Math.round(m.y); hitMonster(p, m, dmgRoll(p, 5)); used = true; }
  } else if (def.key === 'firebolt') {
    const m = nearestMonster(p.x, p.y, c.range + 16);
    if (m) {
      fx.x = Math.round(m.x); fx.y = Math.round(m.y);
      for (let i = 0; i < 3 && !m.dead; i++) hitMonster(p, m, dmgRoll(p, 1.2));
      used = true;
    }
  } else if (def.key === 'frostnova') {
    const list = monstersInRange(p.x, p.y, 115);
    if (list.length) {
      list.forEach(m => { hitMonster(p, m, dmgRoll(p, 1.5)); m.slowUntil = now + 4000; });
      used = true;
    }
  } else if (def.key === 'meteor') {
    const m = nearestMonster(p.x, p.y, 270);
    const cx0 = m ? m.x : p.x, cy0 = m ? m.y : p.y;
    fx.x = Math.round(cx0); fx.y = Math.round(cy0);
    const list = monstersInRange(cx0, cy0, 125);
    if (list.length) { list.forEach(mm => hitMonster(p, mm, dmgRoll(p, 3.5))); used = true; }
  }

  if (used || def.key === 'warcry') {
    p.skillCd[n] = now + def.cd;
    broadcast(fx);
  }
}

wss.on('connection', (ws) => {
  let me = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'join' && !me) {
      const name = cleanName(msg.name);
      const lower = name.toLowerCase();
      const pin = String(msg.pin || '').replace(/\D/g, '').slice(0, 4);
      if (pin.length !== 4) { send(ws, { t: 'joinError', msg: 'PIN must be 4 digits' }); return; }
      const ph = hashPin(pin);
      // already online?
      for (const id in players) {
        if (players[id].name.toLowerCase() === lower) { send(ws, { t: 'joinError', msg: 'This hero is already online' }); return; }
      }
      let cls = CLASSES[msg.cls] ? msg.cls : 'swordsman';
      let restore = null;
      const rec = saves[lower];
      if (rec) {
        if (rec.pinHash !== ph) { send(ws, { t: 'joinError', msg: 'Wrong PIN for this hero name' }); return; }
        restore = rec; cls = rec.cls;
      } else {
        const tok = verifyToken(msg.token);
        if (tok && String(tok.name || '').toLowerCase() === lower) { restore = tok; cls = tok.cls; }
      }
      me = makePlayer(ws, name, cls, ph, restore);
      players[me.id] = me;
      send(ws, {
        t: 'init', id: me.id, map: MAP.map(r => r.join('')), tile: TILE,
        you: publicPlayer(me),
        skills: SKILLS[me.cls].map(s => ({ name: s.name, lvl: s.lvl, cd: s.cd })),
        restored: !!restore
      });
      sendSave(me);
      broadcast({ t: 'event', kind: 'join', name: me.name, id: me.id });
      console.log(`[join] ${me.name} Lv${me.level} (${me.cls})${restore ? ' [restored]' : ''} - ${Object.keys(players).length} online`);
      return;
    }
    if (!me) return;
    if (me.dead) { if (msg.t === 'chat') handleChat(me, msg); return; }

    if (msg.t === 'move') {
      const c = CLASSES[me.cls];
      const now = Date.now();
      const dt = Math.min(now - me.lastMoveMsg, 400);
      me.lastMoveMsg = now;
      const maxDist = c.speed * (dt / 16) + 12;
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
      broadcast({ t: 'event', kind: 'swing', id: me.id, cls: me.cls, dir: me.dir });
      const m = nearestMonster(me.x, me.y, c.range + 16);
      if (m) hitMonster(me, m, dmgRoll(me, 1));
      return;
    }

    if (msg.t === 'skill') { useSkill(me, Number(msg.n) - 1); return; }
    if (msg.t === 'chat') { handleChat(me, msg); return; }
  });

  ws.on('close', () => {
    if (me && players[me.id]) {
      persist(me);
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
  m.respawnAt = Date.now() + (t.boss ? 600000 : 8000 + Math.random() * 7000);
  killer.zeny += t.zeny + Math.floor(Math.random() * t.zeny * 0.5);
  broadcast({ t: 'event', kind: 'mdeath', id: m.id, x: m.x, y: m.y, killer: killer.id, zeny: t.zeny });
  if (t.boss) broadcast({ t: 'event', kind: 'boss', text: killer.name + ' has slain ' + t.name + '! It will return in 10 minutes...' });
  grantXp(killer, t.xp);
  sendSave(killer);
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

  for (const id in monsters) {
    const m = monsters[id];
    const t = MONSTER_TYPES[m.type];
    if (m.dead) {
      if (now >= m.respawnAt) {
        const p = randPointInZone(m.zone);
        m.x = p.x; m.y = p.y; m.homeX = p.x; m.homeY = p.y;
        m.hp = t.hp; m.dead = false; m.target = null; m.slowUntil = 0;
        if (t.boss) broadcast({ t: 'event', kind: 'boss', text: t.name + ' has awakened in the dungeon!' });
      }
      continue;
    }
    const speedMul = now < m.slowUntil ? 0.4 : 1;

    let tgt = m.target ? players[m.target] : null;
    if (tgt && (tgt.dead || Math.hypot(tgt.x - m.x, tgt.y - m.y) > (t.boss ? 500 : 320))) { tgt = null; m.target = null; }
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
        const nx = m.x + dx / d * t.speed * 3 * speedMul, ny = m.y + dy / d * t.speed * 3 * speedMul;
        if (!isBlocked(nx, ny)) { m.x = nx; m.y = ny; }
      } else if (now - m.lastAtk > (t.boss ? 1500 : 1200)) {
        m.lastAtk = now;
        const dmg = Math.max(1, t.atk + Math.floor(Math.random() * 6) - 2);
        tgt.hp -= dmg;
        broadcast({ t: 'event', kind: 'phit', target: tgt.id, from: m.id, dmg });
        if (tgt.hp <= 0) killPlayer(tgt, m);
      }
      // boss stomp: AoE every 6s
      if (t.boss && now - m.lastStomp > 6000) {
        m.lastStomp = now;
        let any = false;
        for (const pid in players) {
          const p = players[pid];
          if (p.dead) continue;
          if (Math.hypot(p.x - m.x, p.y - m.y) < 100) {
            const dmg = Math.max(1, Math.floor(t.atk * 0.8));
            p.hp -= dmg; any = true;
            broadcast({ t: 'event', kind: 'phit', target: p.id, from: m.id, dmg });
            if (p.hp <= 0) killPlayer(p, m);
          }
        }
        if (any) broadcast({ t: 'event', kind: 'stomp', x: Math.round(m.x), y: Math.round(m.y) });
      }
    } else {
      if (now > m.wanderAt) {
        m.wanderAt = now + 2000 + Math.random() * 3000;
        const a = Math.random() * Math.PI * 2;
        m.vx = Math.cos(a) * t.speed * 2; m.vy = Math.sin(a) * t.speed * 2;
        if (Math.random() < 0.4) { m.vx = 0; m.vy = 0; }
      }
      const nx = m.x + m.vx * speedMul, ny = m.y + m.vy * speedMul;
      if (!isBlocked(nx, ny) && Math.hypot(nx - m.homeX, ny - m.homeY) < 160) { m.x = nx; m.y = ny; }
      else { m.vx = -m.vx; m.vy = -m.vy; }
    }
  }

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

  const state = {
    t: 's',
    p: Object.values(players).map(publicPlayer),
    m: Object.values(monsters).filter(m => !m.dead).map(m => ({
      id: m.id, ty: m.type, x: Math.round(m.x), y: Math.round(m.y), hp: m.hp, mh: m.maxHp, tg: !!m.target
    }))
  };
  broadcast(state);
}, 100);

// periodic save token refresh (every 30s to all players)
setInterval(() => { for (const id in players) sendSave(players[id]); }, 30000);

function publicPlayer(p) {
  return {
    id: p.id, n: p.name, c: p.cls, x: Math.round(p.x), y: Math.round(p.y),
    d: p.dir, mv: p.moving, hp: p.hp, mh: p.maxHp, lv: p.level,
    xp: p.xp, xn: xpNeeded(p.level), z: p.zeny, dead: p.dead, b: isBuffed(p) ? 1 : 0
  };
}

server.listen(PORT, () => {
  console.log('=========================================');
  console.log('  RUNE VALLEY ONLINE v2 - server started');
  console.log(`  Local play:  http://localhost:${PORT}`);
  console.log('=========================================');
});
