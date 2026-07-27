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
// ---- SEA SAND SUN beach (below the dungeon, entrance bottom-left of cavern) ----
MAP[MAP.length - 1][10] = 'c'; MAP[MAP.length - 1][11] = 'c';   // entrance in dungeon bottom wall
MAP.push(('s'.repeat(10) + 'cc' + 's'.repeat(40)).split(''));    // corridor row
for (let i = 0; i < 10; i++) MAP.push(('s' + 'd'.repeat(38) + 'w'.repeat(13)).split(''));
MAP.push('w'.repeat(52).split(''));                              // open sea
// palm trees on the sand
[[6,47],[14,49],[22,46],[30,50],[34,47],[9,52],[26,52],[18,53]].forEach(([x,y]) => { if (MAP[y] && MAP[y][x] === 'd') MAP[y][x] = 't'; });
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
  mage:      { hp: 90,  atk: 13, range: 170, cooldown: 900,  speed: 2.9 },
  thief:     { hp: 110, atk: 10, range: 44,  cooldown: 380,  speed: 3.6 },
  merchant:  { hp: 130, atk: 9,  range: 48,  cooldown: 550,  speed: 2.9 }
};

// ---------------- SHOP & EQUIPMENT ----------------
const WEAPON_TIERS = [0, 5, 12, 25, 40, 60];          // atk bonus per tier (4-5 drop only)
const ARMOR_TIERS  = [0, 40, 100, 220, 350, 520];     // max HP bonus
const SHIELD_TIERS = [0, 0.04, 0.08, 0.12, 0.18, 0.25]; // damage reduction
const ACC_TIERS    = [0, 0.03, 0.05, 0.08, 0.12, 0.16]; // +damage%
const TIER_NAMES_W = ['-', 'Iron', 'Steel', 'Runic', 'Valkyrie', 'Celestial'];
const TIER_NAMES_A = ['-', 'Leather', 'Chain', 'Runic', 'Valkyrie', 'Celestial'];
const TIER_NAMES_S = ['-', 'Buckler', 'Kite', 'Tower', 'Valkyrie', 'Celestial'];
const TIER_NAMES_X = ['-', 'Ring', 'Amulet', 'Talisman', 'Relic', 'Celestial'];
const TIER_NAMES = { w: TIER_NAMES_W, a: TIER_NAMES_A, s: TIER_NAMES_S, x: TIER_NAMES_X };
const KIND_NAMES = { w: 'Weapon', a: 'Armor', s: 'Shield', x: 'Accessory' };
const INV_MAX = 24;
function newItem(kind, tier) { return { id: Math.random().toString(36).slice(2, 9), k: kind, t: tier, p: 0, c: null }; }
function itemName(it) { return TIER_NAMES[it.k][it.t] + ' ' + KIND_NAMES[it.k] + (it.p ? ' +' + it.p : ''); }
const SHOP_ITEMS = {
  w1: { kind: 'w', tier: 1, price: 200 },  w2: { kind: 'w', tier: 2, price: 800 },  w3: { kind: 'w', tier: 3, price: 2500 },
  a1: { kind: 'a', tier: 1, price: 200 },  a2: { kind: 'a', tier: 2, price: 800 },  a3: { kind: 'a', tier: 3, price: 2500 },
  s1: { kind: 's', tier: 1, price: 200 },  s2: { kind: 's', tier: 2, price: 800 },
  red: { pot: 'red', price: 15 },          white: { pot: 'white', price: 60 }
};
// stat effects per point: STR +1 atk | VIT +8 HP, +0.2 regen | AGI +0.5% aspd, +0.2% dodge | DEX +0.4% crit | INT +0.8% damage
const STAT_KEYS = ['str', 'vit', 'agi', 'dex', 'int'];
const MAX_PLUS = 10;

// ---------------- CARDS (RO-style monster card drops) ----------------
// w = effect when slotted in weapon, a = effect when slotted in armor
const CARDS = {
  jelly:     { name: 'Jelly Card',      w: { atk: 4 },       a: { hp: 40 },              drop: 0.05  },
  bluejelly: { name: 'Blue Jelly Card', w: { aspd: 0.10 },   a: { regen: 3 },            drop: 0.04  },
  mushy:     { name: 'Mushy Card',      w: { dmg: 0.12 },    a: { dr: 0.10 },            drop: 0.04  },
  wolf:      { name: 'Dire Wolf Card',  w: { crit: 0.08 },   a: { spd: 0.10 },           drop: 0.035 },
  skeleton:  { name: 'Skeleton Card',   w: { ls: 0.08 },     a: { dodge: 0.10 },         drop: 0.03  },
  ghoul:     { name: 'Ghoul Card',      w: { pvp: 0.15 },    a: { hp: 100, dr: 0.05 },   drop: 0.03  },
  direking:  { name: 'GOREHORN CARD',   w: { meteor: 0.10 }, a: { aura: 15 },            drop: 0.25  },
  crab:      { name: 'Tide Crab Card',  w: { atk: 8 },       a: { hp: 60, dr: 0.05 },    drop: 0.04  },
  siren:     { name: 'Siren Card',      w: { aspd: 0.12 },   a: { regen: 5 },            drop: 0.035 },
  solaris:   { name: 'SOLARIS CARD',    w: { solar: 0.15 },  a: { hp: 200, regen: 5, spd: 0.05 }, drop: 0.30 }
};
function cardEff(p, side, key) {
  // weapon+accessory sockets use card w-effects; armor+shield sockets use a-effects
  let v = 0;
  for (const sl of (side === 'w' ? ['w', 'x'] : ['a', 's'])) {
    const id = p.eq.eqp ? p.eq.eqp[sl] : null;
    if (!id) continue;
    const it = p.eq.inv.find(i => i.id === id);
    if (it && it.c && CARDS[it.c]) v += (side === 'w' ? CARDS[it.c].w : CARDS[it.c].a)[key] || 0;
  }
  return v;
}
function upgradeCost(cur) { return Math.round(100 * Math.pow(1.6, cur)); }
function upgradeChance(cur) { return Math.pow(0.8, cur); } // 80% at +0, ~13% at +9
function inTown(p) { return p.x >= 8 * TILE && p.x <= 18 * TILE && p.y >= 3 * TILE && p.y <= 8 * TILE; }
function defaultEq() { return { red: 0, white: 0, cards: {}, inv: [], eqp: { w: null, a: null, s: null, x: null } }; }
function migrateEq(eq) {
  if (!eq) return defaultEq();
  if (eq.inv) { eq.eqp = eq.eqp || { w: null, a: null, s: null, x: null }; eq.cards = eq.cards || {}; return eq; }
  // legacy format -> item inventory
  const ne = { red: eq.red || 0, white: eq.white || 0, cards: eq.cards || {}, inv: [], eqp: { w: null, a: null, s: null, x: null } };
  if (eq.wt) { const it = newItem('w', eq.wt); it.p = eq.wp || 0; it.c = eq.wc || null; ne.inv.push(it); ne.eqp.w = it.id; }
  if (eq.at) { const it = newItem('a', eq.at); it.p = eq.ap || 0; it.c = eq.ac || null; ne.inv.push(it); ne.eqp.a = it.id; }
  return ne;
}
function equippedItem(p, slot) {
  const id = p.eq.eqp[slot];
  return id ? p.eq.inv.find(i => i.id === id) || null : null;
}
function recalcStats(p) {
  const base = statsForLevel(p.cls, p.level);
  const ratio = p.maxHp ? Math.min(1, p.hp / p.maxHp) : 1;
  const w = equippedItem(p, 'w'), a = equippedItem(p, 'a'), s = equippedItem(p, 's'), x = equippedItem(p, 'x');
  const st = p.st;
  p.atk = base.atk + st.str + (w ? WEAPON_TIERS[w.t] + w.p * 3 : 0) + cardEff(p, 'w', 'atk') + (p.adv ? 5 : 0);
  p.maxHp = base.maxHp + st.vit * 8 + (a ? ARMOR_TIERS[a.t] + a.p * 25 : 0) + (s ? s.p * 20 : 0) + cardEff(p, 'a', 'hp') + (p.adv ? 60 : 0);
  p.drBonus = (s ? SHIELD_TIERS[s.t] + s.p * 0.005 : 0);
  p.dmgBonus = (x ? ACC_TIERS[x.t] + x.p * 0.005 : 0) + st.int * 0.008;
  p.aspdBonus = st.agi * 0.005;
  p.dodgeBonus = st.agi * 0.002;
  p.critBonus = st.dex * 0.004;
  p.regenBonus = st.vit * 0.2;
  p.hp = Math.max(1, Math.round(p.maxHp * ratio));
}
// skill defs: unlock level, cooldown ms, behavior handled in useSkill()
const ADV_NAMES = { swordsman: 'Knight', archer: 'Sniper', mage: 'Wizard', thief: 'Assassin', merchant: 'Tycoon' };
const SKILLS = {
  swordsman: [
    { key: 'bash',      name: 'Bash',         lvl: 3,  cd: 4000 },
    { key: 'whirl',     name: 'Whirlwind',    lvl: 6,  cd: 8000 },
    { key: 'warcry',    name: 'War Cry',      lvl: 10, cd: 20000 },
    { key: 'bbash',     name: 'Bowling Bash', lvl: 30, cd: 8000 },
    { key: 'quicken',   name: 'Quicken',      lvl: 35, cd: 20000 },
    { key: 'lordaura',  name: 'Lord Strike',  lvl: 40, cd: 15000 }
  ],
  archer: [
    { key: 'dstrafe',   name: 'Double Strafe', lvl: 3,  cd: 4000 },
    { key: 'arrowrain', name: 'Arrow Rain',    lvl: 6,  cd: 9000 },
    { key: 'snipe',     name: 'Snipe',         lvl: 10, cd: 15000 },
    { key: 'focus',     name: 'Focused Arrow', lvl: 30, cd: 10000 },
    { key: 'astorm',    name: 'Arrow Storm',   lvl: 35, cd: 12000 },
    { key: 'truesight', name: 'True Sight',    lvl: 40, cd: 25000 }
  ],
  mage: [
    { key: 'firebolt',  name: 'Firebolt',     lvl: 3,  cd: 4000 },
    { key: 'frostnova', name: 'Frost Nova',   lvl: 6,  cd: 10000 },
    { key: 'meteor',    name: 'Meteor',       lvl: 10, cd: 18000 },
    { key: 'jupitel',   name: 'Jupitel',      lvl: 30, cd: 8000 },
    { key: 'stormgust', name: 'Storm Gust',   lvl: 35, cd: 14000 },
    { key: 'inferno',   name: 'Hell Inferno', lvl: 40, cd: 16000 }
  ],
  thief: [
    { key: 'dbl',       name: 'Double Attack', lvl: 3,  cd: 4000 },
    { key: 'backstab',  name: 'Backstab',      lvl: 6,  cd: 8000 },
    { key: 'shadow',    name: 'Shadow Dash',   lvl: 10, cd: 12000 },
    { key: 'sonic',     name: 'Sonic Blow',    lvl: 30, cd: 10000 },
    { key: 'venom',     name: 'Venom Edge',    lvl: 35, cd: 12000 },
    { key: 'crossimpact', name: 'Cross Impact', lvl: 40, cd: 15000 }
  ],
  merchant: [
    { key: 'mammonite', name: 'Mammonite',    lvl: 3,  cd: 5000 },
    { key: 'cointoss',  name: 'Coin Toss',    lvl: 6,  cd: 8000 },
    { key: 'greed',     name: 'Greed Aura',   lvl: 10, cd: 20000 },
    { key: 'cartterm',  name: 'Cart Cannon',  lvl: 30, cd: 10000 },
    { key: 'goldrush',  name: 'Gold Rush',    lvl: 35, cd: 25000 },
    { key: 'meltdown',  name: 'Meltdown',     lvl: 40, cd: 14000 }
  ]
};

// ---------------- MONSTERS (v2: harder + aggressive) ----------------
const MONSTER_TYPES = {
  jelly:     { name: 'Jelly',       hp: 80,   atk: 8,  xp: 14,   zeny: 9,    speed: 0.9, aggro: 80,  lvl: 2  },
  bluejelly: { name: 'Blue Jelly',  hp: 180,  atk: 18, xp: 45,   zeny: 26,   speed: 1.2, aggro: 150, lvl: 6  },
  mushy:     { name: 'Mushy',       hp: 330,  atk: 30, xp: 90,   zeny: 60,   speed: 0.9, aggro: 170, lvl: 10 },
  wolf:      { name: 'Dire Wolf',   hp: 680,  atk: 45, xp: 220,  zeny: 135,  speed: 1.9, aggro: 220, lvl: 15 },
  skeleton:  { name: 'Skeleton',    hp: 950,  atk: 55, xp: 380,  zeny: 210,  speed: 1.5, aggro: 240, lvl: 20 },
  ghoul:     { name: 'Ghoul',       hp: 1400, atk: 70, xp: 600,  zeny: 330,  speed: 1.2, aggro: 260, lvl: 25 },
  direking:  { name: 'Gorehorn the Dire King', hp: 9000, atk: 100, xp: 4500, zeny: 4000, speed: 1.9, aggro: 320, lvl: 40, boss: true },
  crab:      { name: 'Tide Crab',   hp: 1200, atk: 60,  xp: 800,   zeny: 450,  speed: 1.0, aggro: 240, lvl: 26 },
  siren:     { name: 'Siren',       hp: 1800, atk: 80,  xp: 1300,  zeny: 700,  speed: 1.3, aggro: 260, lvl: 32 },
  solaris:   { name: 'SOLARIS the Sun Tyrant', hp: 40000, atk: 160, xp: 15000, zeny: 14000, speed: 2.0, aggro: 340, lvl: 60, boss: true, mvp: true, armor: 0.3 }
};
// monster skills: fired while chasing a target, on a cooldown ("fx" reuses client skill visuals)
const MOB_SKILLS = {
  jelly:     { cd: 7000,  fx: 'quicken' },    // gel mend: heals itself
  bluejelly: { cd: 6000,  fx: 'jupitel' },    // water bolt: ranged zap
  mushy:     { cd: 8000,  fx: 'venom' },      // spore cloud: AoE poison burst
  wolf:      { cd: 9000,  fx: 'shadow' },     // pounce: leaps onto its prey
  skeleton:  { cd: 7000,  fx: 'focus' },      // bone throw: long-range hit
  ghoul:     { cd: 8000,  fx: 'crossimpact' },// life drain: damage + self heal
  crab:      { cd: 10000, fx: 'quicken' },    // bubble shell: 50% damage shield 4s
  siren:     { cd: 8000,  fx: 'frostnova' },  // siren song: AoE scream
  direking:  { cd: 12000, fx: 'bbash' }       // dire roar: heavy AoE
  // solaris has its own rotation below
};
const SPAWN_ZONES = [
  ['jelly',     8, 20, 2,  48, 10],
  ['jelly',     4, 2,  24, 18, 30],
  ['bluejelly', 5, 20, 13, 40, 20],
  ['mushy',     4, 25, 23, 48, 30],
  ['wolf',      3, 30, 24, 49, 30],
  ['skeleton',  5, 3,  33, 25, 42],
  ['ghoul',     4, 26, 33, 48, 42],
  ['direking',  1, 34, 36, 46, 41],
  ['crab',      5, 2,  46, 30, 54],
  ['siren',     4, 15, 46, 37, 54],
  ['solaris',   1, 28, 48, 37, 54]
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
let saves = {};   // nameLower -> {name, cls, level, xp, zeny, eq, pinHash, seen}
let savesDirty = false;
const dirtyNames = new Set();
try { saves = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')); console.log('[saves] loaded', Object.keys(saves).length, 'heroes from file'); } catch { saves = {}; }

// ---- cloud database (Supabase) - active when env vars are set ----
const DB_URL = process.env.SAVE_DB_URL || '';
const DB_KEY = process.env.SAVE_DB_KEY || '';
const dbOn = !!(DB_URL && DB_KEY);
const dbHeaders = { apikey: DB_KEY, Authorization: 'Bearer ' + DB_KEY, 'Content-Type': 'application/json' };

async function dbLoadAll() {
  if (!dbOn) return;
  try {
    const r = await fetch(DB_URL + '/rest/v1/saves?select=name,data', { headers: dbHeaders });
    if (!r.ok) { console.log('[db] load failed:', r.status); return; }
    const rows = await r.json();
    for (const row of rows) {
      // cloud copy wins unless the local one is newer
      if (!saves[row.name] || (row.data.seen || 0) >= (saves[row.name].seen || 0)) saves[row.name] = row.data;
    }
    console.log('[db] loaded', rows.length, 'heroes from cloud');
  } catch (e) { console.log('[db] load error:', e.message); }
}
async function dbFlush() {
  if (!dbOn || dirtyNames.size === 0) return;
  const batch = [...dirtyNames].map(n => ({ name: n, data: saves[n] })).filter(r => r.data);
  dirtyNames.clear();
  try {
    const r = await fetch(DB_URL + '/rest/v1/saves', {
      method: 'POST',
      headers: { ...dbHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(batch)
    });
    if (!r.ok) console.log('[db] flush failed:', r.status, await r.text().catch(() => ''));
  } catch (e) { console.log('[db] flush error:', e.message); }
}
dbLoadAll();
console.log(dbOn ? '[db] cloud persistence ENABLED' : '[db] cloud persistence off (no SAVE_DB_URL/SAVE_DB_KEY) - file only');

setInterval(() => {
  if (savesDirty) {
    savesDirty = false;
    fs.writeFile(SAVE_FILE, JSON.stringify(saves), () => {});
  }
  dbFlush();
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
  return { name: p.name, cls: p.cls, level: p.level, xp: p.xp, zeny: p.zeny, eq: p.eq, st: p.st, sp: p.sp, adv: p.adv || 0, pinHash: p.pinHash, seen: Date.now() };
}
function sendInv(p) {
  send(p.ws, { t: 'inv', inv: p.eq.inv, eqp: p.eq.eqp, st: p.st, sp: p.sp });
}
function persist(p) {
  const lower = p.name.toLowerCase();
  saves[lower] = recordOf(p);
  savesDirty = true;
  dirtyNames.add(lower);
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
  const p = {
    id, ws, name, cls, pinHash,
    x: SPAWN.x + (Math.random() * 60 - 30), y: SPAWN.y + (Math.random() * 60 - 30),
    dir: 'down', moving: false,
    hp: st.maxHp, maxHp: st.maxHp, atk: st.atk,
    level, xp: restore ? restore.xp : 0, zeny: restore ? restore.zeny : 0,
    eq: migrateEq(restore ? restore.eq : null),
    st: (restore && restore.st) ? { str: 0, vit: 0, agi: 0, dex: 0, int: 0, ...restore.st } : { str: 0, vit: 0, agi: 0, dex: 0, int: 0 },
    sp: (restore && restore.sp !== undefined) ? restore.sp : Math.max(0, (level - 1) * 3),
    adv: restore ? (restore.adv || 0) : 0,
    lastAtk: 0, lastPot: 0, skillCd: [0, 0, 0, 0, 0, 0], buffUntil: 0, zenyBuffUntil: 0,
    quickenUntil: 0, tsUntil: 0,
    dead: false, respawnAt: 0, lastMoveMsg: Date.now(),
    protectUntil: Date.now() + 4000
  };
  recalcStats(p);
  p.hp = p.maxHp;
  return p;
}

function xpNeeded(level) { return Math.floor(20 * Math.pow(level, 1.6)); }

function grantXp(p, amount) {
  p.xp += amount;
  let leveled = false;
  while (p.xp >= xpNeeded(p.level)) {
    p.xp -= xpNeeded(p.level);
    p.level++;
    leveled = true;
    p.sp += 3; // stat points per level
    // 2nd job advancement at level 30
    if (p.level >= 30 && !p.adv) {
      p.adv = 1;
      broadcast({ t: 'event', kind: 'boss', text: '⭐ ' + p.name + ' has advanced to ' + ADV_NAMES[p.cls].toUpperCase() + '!' });
      broadcast({ t: 'event', kind: 'levelup', id: p.id, level: p.level });
    }
    recalcStats(p);
    p.hp = p.maxHp;
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

// ---------------- MAINTENANCE MODE (admin: the hero named ADMIN_NAME) ----------------
let maintenance = false;
const ADMIN_NAME = (process.env.ADMIN_NAME || '007').toLowerCase();
function startMaintenance() {
  broadcast({ t: 'event', kind: 'boss', text: '⚠️ SERVER MAINTENANCE in 10 seconds! Progress is saved.' });
  let n = 10;
  const iv = setInterval(() => {
    n--;
    if (n > 0) {
      broadcast({ t: 'event', kind: 'boss', text: '⚠️ Maintenance in ' + n + '...' });
    } else {
      clearInterval(iv);
      maintenance = true;
      broadcast({ t: 'event', kind: 'boss', text: '🔧 SERVER CLOSED FOR MAINTENANCE - back soon!' });
      setTimeout(() => {
        for (const id in players) {
          try { persist(players[id]); players[id].ws.close(); } catch (e) {}
        }
        dbFlush();
        console.log('[maint] server closed for maintenance');
      }, 800);
    }
  }, 1000);
}

function cleanName(raw) {
  let n = String(raw || '').replace(/[^\w\- ]/g, '').trim().slice(0, 12);
  return n.length ? n : 'Novice' + Math.floor(Math.random() * 999);
}

function isBuffed(p) { return Date.now() < p.buffUntil; }
function baseDmg(p) { return p.atk + p.level * 1.5 + Math.random() * 6 - 2; }
function dmgRoll(p, mult) {
  let d = baseDmg(p) * mult * (isBuffed(p) ? 1.6 : 1);
  d *= 1 + cardEff(p, 'w', 'dmg') + (p.dmgBonus || 0);    // Mushy card + accessory + INT
  if (Date.now() < p.tsUntil) d *= 1.3;                   // True Sight buff
  const critCh = cardEff(p, 'w', 'crit') + (p.critBonus || 0) + (Date.now() < p.tsUntil ? 0.15 : 0);
  if (Math.random() < critCh) d *= 2;                     // crit
  return Math.max(1, Math.floor(d));
}
function lifesteal(p, dmg) {
  const ls = cardEff(p, 'w', 'ls');                       // Skeleton card
  if (ls > 0 && !p.dead) p.hp = Math.min(p.maxHp, p.hp + Math.max(1, Math.floor(dmg * ls)));
}

function hitMonster(p, m, dmg) {
  const t = MONSTER_TYPES[m.type];
  if (t.armor) dmg = Math.max(1, Math.floor(dmg * (1 - t.armor)));            // MVP natural armor
  if (Date.now() < (m.shieldUntil || 0)) dmg = Math.max(1, Math.floor(dmg * 0.5)); // crab bubble shell
  m.hp -= dmg;
  m.target = p.id;
  lifesteal(p, dmg);
  broadcast({ t: 'event', kind: 'hit', from: p.id, target: m.id, dmg, tx: m.x, ty: m.y, cls: p.cls });
  if (m.hp <= 0) killMonster(m, p);
}

// damage from a monster to a player, respecting armor cards
function monsterHitsPlayer(m, t, rawDmg) {
  const p = t;
  if (Math.random() < cardEff(p, 'a', 'dodge') + (p.dodgeBonus || 0)) {
    broadcast({ t: 'event', kind: 'hit', from: m.id, target: p.id, dmg: 'MISS', tx: Math.round(p.x), ty: Math.round(p.y) });
    return false;
  }
  const dr = Math.min(0.75, cardEff(p, 'a', 'dr') + (p.drBonus || 0));
  const dmg = Math.max(1, Math.floor(rawDmg * (1 - dr)));
  p.hp -= dmg;
  broadcast({ t: 'event', kind: 'phit', target: p.id, from: m.id, dmg });
  return p.hp <= 0;
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

// ---------------- PVP (players can fight each other everywhere) ----------------
function pvpTargetable(v, attacker) {
  return v && !v.dead && v.id !== attacker.id && Date.now() >= v.protectUntil;
}
function playersInRange(attacker, x, y, r) {
  const out = [];
  for (const id in players) {
    const v = players[id];
    if (pvpTargetable(v, attacker) && Math.hypot(v.x - x, v.y - y) <= r) out.push(v);
  }
  return out;
}
function nearestAny(attacker, maxR) {
  const m = nearestMonster(attacker.x, attacker.y, maxR);
  let bestP = null, bd = Infinity;
  for (const id in players) {
    const v = players[id];
    if (!pvpTargetable(v, attacker)) continue;
    const d = Math.hypot(v.x - attacker.x, v.y - attacker.y);
    if (d < bd) { bd = d; bestP = v; }
  }
  if (bestP && bd <= maxR) {
    if (!m || bd < Math.hypot(m.x - attacker.x, m.y - attacker.y)) return { p: bestP };
  }
  return m ? { m } : null;
}
function hitPlayer(a, v, dmg) {
  if (!pvpTargetable(v, a)) return;
  dmg = dmg * 0.6;                                        // PvP damage reduction
  dmg *= 1 + cardEff(a, 'w', 'pvp');                      // Ghoul card: +PvP damage
  if (Math.random() < cardEff(v, 'a', 'dodge') + (v.dodgeBonus || 0)) {
    broadcast({ t: 'event', kind: 'hit', from: a.id, target: v.id, dmg: 'MISS', tx: Math.round(v.x), ty: Math.round(v.y), cls: a.cls });
    return;
  }
  const vdr = Math.min(0.75, cardEff(v, 'a', 'dr') + (v.drBonus || 0));
  dmg = Math.max(1, Math.floor(dmg * (1 - vdr)));
  v.hp -= dmg;
  lifesteal(a, dmg);
  broadcast({ t: 'event', kind: 'hit', from: a.id, target: v.id, dmg, tx: Math.round(v.x), ty: Math.round(v.y), cls: a.cls });
  if (v.hp <= 0) {
    v.dead = true;
    v.respawnAt = Date.now() + 3000;
    v.moving = false;
    broadcast({ t: 'event', kind: 'pkill', killer: a.name, victim: v.name, kid: a.id, vid: v.id });
    grantXp(a, 15 + v.level * 5);
  }
}
function hitAny(a, tgt, dmg) {
  if (tgt.m) hitMonster(a, tgt.m, dmg);
  else if (tgt.p) hitPlayer(a, tgt.p, dmg);
  // GOREHORN weapon card: chance to call a meteor strike on the target
  if (Math.random() < cardEff(a, 'w', 'meteor')) {
    const o = tgt.m || tgt.p;
    broadcast({ t: 'event', kind: 'skillfx', id: a.id, skill: 'meteor', x: Math.round(o.x), y: Math.round(o.y) });
    monstersInRange(o.x, o.y, 100).forEach(mm => hitMonster(a, mm, Math.max(1, Math.floor(baseDmg(a) * 2.5))));
    playersInRange(a, o.x, o.y, 100).forEach(vv => hitPlayer(a, vv, baseDmg(a) * 2.5));
  }
  // SOLARIS weapon card: chance of a solar flare
  if (Math.random() < cardEff(a, 'w', 'solar')) {
    const o = tgt.m || tgt.p;
    broadcast({ t: 'event', kind: 'skillfx', id: a.id, skill: 'inferno', x: Math.round(o.x), y: Math.round(o.y) });
    monstersInRange(o.x, o.y, 120).forEach(mm => hitMonster(a, mm, Math.max(1, Math.floor(baseDmg(a) * 3))));
    playersInRange(a, o.x, o.y, 120).forEach(vv => hitPlayer(a, vv, baseDmg(a) * 3));
  }
}
function tgtPos(tgt) { return tgt.m ? tgt.m : tgt.p; }

function useSkill(p, n) {
  const defs = SKILLS[p.cls];
  if (!defs || n < 0 || n > 5) return;
  const def = defs[n];
  const now = Date.now();
  if (p.level < def.lvl) return;
  if (now < p.skillCd[n]) return;
  const c = CLASSES[p.cls];

  let fx = { t: 'event', kind: 'skillfx', id: p.id, skill: def.key, x: Math.round(p.x), y: Math.round(p.y) };
  let used = false;

  const aoe = (cx0, cy0, r, mult, slow) => {
    const ms = monstersInRange(cx0, cy0, r);
    const ps = playersInRange(p, cx0, cy0, r);
    ms.forEach(m => { hitMonster(p, m, dmgRoll(p, mult)); if (slow) m.slowUntil = now + 4000; });
    ps.forEach(v => hitPlayer(p, v, dmgRoll(p, mult)));
    return ms.length + ps.length > 0;
  };

  if (def.key === 'bash') {
    const t = nearestAny(p, c.range + 16);
    if (t) { const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y); hitAny(p, t, dmgRoll(p, 3)); used = true; }
  } else if (def.key === 'whirl') {
    used = aoe(p.x, p.y, 90, 2, false);
  } else if (def.key === 'warcry') {
    p.buffUntil = now + 8000;
    used = true;
  } else if (def.key === 'dstrafe') {
    const t = nearestAny(p, c.range + 16);
    if (t) { const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y); hitAny(p, t, dmgRoll(p, 1.5)); hitAny(p, t, dmgRoll(p, 1.5)); used = true; }
  } else if (def.key === 'arrowrain') {
    const t = nearestAny(p, c.range + 40);
    const o = t ? tgtPos(t) : p;
    fx.x = Math.round(o.x); fx.y = Math.round(o.y);
    used = aoe(o.x, o.y, 95, 1.5, false);
  } else if (def.key === 'snipe') {
    const t = nearestAny(p, 270);
    if (t) { const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y); hitAny(p, t, dmgRoll(p, 5)); used = true; }
  } else if (def.key === 'firebolt') {
    const t = nearestAny(p, c.range + 16);
    if (t) {
      const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y);
      for (let i = 0; i < 3; i++) hitAny(p, t, dmgRoll(p, 1.2));
      used = true;
    }
  } else if (def.key === 'frostnova') {
    used = aoe(p.x, p.y, 115, 1.5, true);
  } else if (def.key === 'meteor') {
    const t = nearestAny(p, 270);
    const o = t ? tgtPos(t) : p;
    fx.x = Math.round(o.x); fx.y = Math.round(o.y);
    used = aoe(o.x, o.y, 125, 3.5, false);
  } else if (def.key === 'dbl') {
    const t = nearestAny(p, c.range + 16);
    if (t) { const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y); hitAny(p, t, dmgRoll(p, 1.3)); hitAny(p, t, dmgRoll(p, 1.3)); used = true; }
  } else if (def.key === 'backstab') {
    const t = nearestAny(p, c.range + 16);
    if (t) { const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y); hitAny(p, t, dmgRoll(p, 2.8)); used = true; }
  } else if (def.key === 'shadow') {
    const t = nearestAny(p, 300);
    if (t) {
      const o = tgtPos(t);
      // teleport next to target (find a free spot)
      for (const [ox, oy] of [[-30,0],[30,0],[0,-30],[0,30],[-24,-24],[24,24]]) {
        if (!isBlocked(o.x + ox, o.y + oy)) { p.x = o.x + ox; p.y = o.y + oy; break; }
      }
      fx.x = Math.round(o.x); fx.y = Math.round(o.y);
      hitAny(p, t, dmgRoll(p, 2));
      used = true;
    }
  } else if (def.key === 'mammonite') {
    if (p.zeny >= 20) {
      const t = nearestAny(p, c.range + 16);
      if (t) { p.zeny -= 20; const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y); hitAny(p, t, dmgRoll(p, 4)); used = true; }
    }
  } else if (def.key === 'cointoss') {
    if (p.zeny >= 10) {
      const t = nearestAny(p, 200);
      if (t) { p.zeny -= 10; const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y); hitAny(p, t, dmgRoll(p, 2)); used = true; }
    }
  } else if (def.key === 'greed') {
    p.zenyBuffUntil = now + 10000;
    used = true;
  } else if (def.key === 'bbash') {
    used = aoe(p.x, p.y, 100, 3.5, false);
  } else if (def.key === 'quicken') {
    p.quickenUntil = now + 10000;
    used = true;
  } else if (def.key === 'lordaura') {
    const t = nearestAny(p, c.range + 30);
    if (t) { const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y); hitAny(p, t, dmgRoll(p, 7)); used = true; }
  } else if (def.key === 'focus') {
    const t = nearestAny(p, 300);
    if (t) { const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y); hitAny(p, t, dmgRoll(p, 6)); used = true; }
  } else if (def.key === 'astorm') {
    const t = nearestAny(p, 280);
    const o = t ? tgtPos(t) : p;
    fx.x = Math.round(o.x); fx.y = Math.round(o.y);
    used = aoe(o.x, o.y, 130, 2, false);
  } else if (def.key === 'truesight') {
    p.tsUntil = now + 10000;
    used = true;
  } else if (def.key === 'jupitel') {
    const t = nearestAny(p, 280);
    if (t) { const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y); hitAny(p, t, dmgRoll(p, 4.5)); used = true; }
  } else if (def.key === 'stormgust') {
    const t = nearestAny(p, 280);
    const o = t ? tgtPos(t) : p;
    fx.x = Math.round(o.x); fx.y = Math.round(o.y);
    const ms = monstersInRange(o.x, o.y, 140);
    const ps = playersInRange(p, o.x, o.y, 140);
    ms.forEach(m => { hitMonster(p, m, dmgRoll(p, 2)); m.slowUntil = now + 5000; });
    ps.forEach(v => hitPlayer(p, v, dmgRoll(p, 2)));
    used = ms.length + ps.length > 0;
  } else if (def.key === 'inferno') {
    const t = nearestAny(p, 280);
    const o = t ? tgtPos(t) : p;
    fx.x = Math.round(o.x); fx.y = Math.round(o.y);
    used = aoe(o.x, o.y, 120, 4, false);
  } else if (def.key === 'sonic') {
    const t = nearestAny(p, c.range + 16);
    if (t) {
      const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y);
      for (let i = 0; i < 8; i++) hitAny(p, t, dmgRoll(p, 0.8));
      used = true;
    }
  } else if (def.key === 'venom') {
    const t = nearestAny(p, c.range + 16);
    if (t) {
      const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y);
      hitAny(p, t, dmgRoll(p, 3));
      if (t.m) t.m.slowUntil = now + 5000;
      used = true;
    }
  } else if (def.key === 'crossimpact') {
    const t = nearestAny(p, c.range + 30);
    if (t) { const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y); hitAny(p, t, dmgRoll(p, 6)); used = true; }
  } else if (def.key === 'cartterm') {
    if (p.zeny >= 100) {
      const t = nearestAny(p, c.range + 30);
      if (t) { p.zeny -= 100; const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y); hitAny(p, t, dmgRoll(p, 5)); used = true; }
    }
  } else if (def.key === 'goldrush') {
    p.zenyBuffUntil = now + 15000;
    used = true;
  } else if (def.key === 'meltdown') {
    used = aoe(p.x, p.y, 110, 3, false);
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
      if (maintenance && lower !== ADMIN_NAME) {
        send(ws, { t: 'joinError', msg: '🔧 Server under maintenance - please come back in a few minutes!' });
        return;
      }
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
      sendInv(me);
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
      const maxDist = c.speed * (1 + cardEff(me, 'a', 'spd')) * (dt / 16) + 12;
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
      if (now - me.lastAtk < c.cooldown * Math.max(0.35, 1 - cardEff(me, 'w', 'aspd') - (me.aspdBonus || 0)) * (now < me.quickenUntil ? 0.6 : 1)) return;
      me.lastAtk = now;
      broadcast({ t: 'event', kind: 'swing', id: me.id, cls: me.cls, dir: me.dir });
      const t = nearestAny(me, c.range + 16);
      if (t) hitAny(me, t, dmgRoll(me, 1));
      return;
    }

    if (msg.t === 'skill') { useSkill(me, Number(msg.n) - 1); return; }
    if (msg.t === 'shop') {
      if (!inTown(me)) { send(ws, { t: 'shopnote', ok: false, msg: 'Walk to the shop stall in town first!' }); return; }
      if (msg.action === 'buy') {
        const it = SHOP_ITEMS[msg.item];
        if (!it) return;
        if (me.zeny < it.price) { send(ws, { t: 'shopnote', ok: false, msg: 'Not enough zeny!' }); return; }
        if (it.pot) {
          me.zeny -= it.price;
          me.eq[it.pot]++;
          send(ws, { t: 'shopnote', ok: true, msg: 'Bought 1 ' + (it.pot === 'red' ? 'Red' : 'White') + ' Potion' });
        } else {
          if (me.eq.inv.length >= INV_MAX) { send(ws, { t: 'shopnote', ok: false, msg: 'Inventory full!' }); return; }
          me.zeny -= it.price;
          const item = newItem(it.kind, it.tier);
          me.eq.inv.push(item);
          send(ws, { t: 'shopnote', ok: true, msg: 'Bought ' + itemName(item) + ' - equip it in [E]' });
          sendInv(me);
        }
        sendSave(me);
        return;
      }
      if (msg.action === 'upgrade') { send(ws, { t: 'shopnote', ok: false, msg: 'Upgrading moved to the Equipment window - press E' }); return; }
      return;
    }
    if (msg.t === 'item') {
      const findItem = id => me.eq.inv.find(i => i.id === id);
      if (msg.action === 'equip') {
        const it = findItem(msg.item);
        if (!it) return;
        me.eq.eqp[it.k] = it.id;
        recalcStats(me);
        send(ws, { t: 'shopnote', ok: true, msg: 'Equipped ' + itemName(it) });
      } else if (msg.action === 'unequip') {
        if (['w','a','s','x'].includes(msg.slot)) { me.eq.eqp[msg.slot] = null; recalcStats(me); }
      } else if (msg.action === 'drop') {
        const it = findItem(msg.item);
        if (!it) return;
        if (it.c) { me.eq.cards[it.c] = (me.eq.cards[it.c] || 0) + 1; } // card returned before item destroyed
        for (const sl of ['w','a','s','x']) if (me.eq.eqp[sl] === it.id) me.eq.eqp[sl] = null;
        me.eq.inv = me.eq.inv.filter(i => i.id !== it.id);
        recalcStats(me);
        send(ws, { t: 'shopnote', ok: true, msg: itemName(it) + ' discarded' + (it.c ? ' (card returned)' : '') });
      } else if (msg.action === 'setcard') {
        const it = findItem(msg.item);
        const ck = msg.card;
        if (!it || !CARDS[ck] || !(me.eq.cards[ck] > 0)) { send(ws, { t: 'shopnote', ok: false, msg: 'Card not available' }); return; }
        if (it.c) me.eq.cards[it.c] = (me.eq.cards[it.c] || 0) + 1; // swap: old card back to bag
        me.eq.cards[ck]--;
        it.c = ck;
        recalcStats(me);
        send(ws, { t: 'shopnote', ok: true, msg: CARDS[ck].name + ' socketed into ' + itemName(it) });
        if (ck === 'direking' || ck === 'solaris') broadcast({ t: 'event', kind: 'boss', text: me.name + ' socketed the ' + CARDS[ck].name + '!' });
      } else if (msg.action === 'delcard') {
        const it = findItem(msg.item);
        if (!it || !it.c) return;
        me.eq.cards[it.c] = (me.eq.cards[it.c] || 0) + 1;
        send(ws, { t: 'shopnote', ok: true, msg: CARDS[it.c].name + ' removed and returned to your card bag' });
        it.c = null;
        recalcStats(me);
      } else if (msg.action === 'upgrade') {
        const it = findItem(msg.item);
        if (!it) return;
        if (it.p >= MAX_PLUS) { send(ws, { t: 'shopnote', ok: false, msg: 'Already at max +' + MAX_PLUS }); return; }
        const cost = upgradeCost(it.p);
        if (me.zeny < cost) { send(ws, { t: 'shopnote', ok: false, msg: 'Need ' + cost + 'z' }); return; }
        me.zeny -= cost;
        if (Math.random() < upgradeChance(it.p)) {
          it.p++;
          recalcStats(me);
          send(ws, { t: 'shopnote', ok: true, msg: 'SUCCESS! ' + itemName(it) + '!' });
          if (it.p >= 8) broadcast({ t: 'event', kind: 'boss', text: me.name + ' refined ' + itemName(it) + '!' });
        } else {
          send(ws, { t: 'shopnote', ok: false, msg: 'FAILED... ' + cost + 'z gone. The anvil laughs.' });
        }
      } else if (msg.action === 'statup') {
        const k = msg.stat;
        if (STAT_KEYS.includes(k) && me.sp > 0) { me.st[k]++; me.sp--; recalcStats(me); }
      }
      sendInv(me);
      sendSave(me);
      return;
    }
    if (msg.t === 'card') {
      send(ws, { t: 'shopnote', ok: false, msg: 'Cards are now socketed via the Equipment window - press E' });
      return;
    }
    if (msg.t === 'pot') {
      const kind = msg.kind === 'white' ? 'white' : 'red';
      const now = Date.now();
      if (me.eq[kind] > 0 && now - me.lastPot > 800 && me.hp < me.maxHp) {
        me.lastPot = now;
        me.eq[kind]--;
        const heal = kind === 'red' ? 80 : 300;
        me.hp = Math.min(me.maxHp, me.hp + heal);
        broadcast({ t: 'event', kind: 'heal', id: me.id, amt: heal, x: Math.round(me.x), y: Math.round(me.y) });
      }
      return;
    }
    if (msg.t === 'rank') {
      const top = Object.values(saves)
        .sort((a, b) => b.level - a.level || b.zeny - a.zeny)
        .slice(0, 10)
        .map(r => ({ n: r.name, c: r.cls, lv: r.level, z: r.zeny }));
      send(ws, { t: 'rank', top });
      return;
    }
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
  // admin commands (only the admin hero, protected by their PIN)
  if (text.startsWith('/') && p.name.toLowerCase() === ADMIN_NAME) {
    if (text === '/maint') { startMaintenance(); return; }
    if (text === '/open') {
      maintenance = false;
      broadcast({ t: 'event', kind: 'boss', text: '✅ Maintenance complete - SERVER IS OPEN! Welcome back!' });
      console.log('[maint] server reopened');
      return;
    }
  }
  broadcast({ t: 'event', kind: 'chat', id: p.id, name: p.name, text });
}

function killMonster(m, killer) {
  const t = MONSTER_TYPES[m.type];
  m.dead = true;
  m.respawnAt = Date.now() + (t.mvp ? 1200000 : t.boss ? 600000 : 8000 + Math.random() * 7000);
  let zmult = 1;
  if (killer.cls === 'merchant') zmult *= 1.3;
  if (Date.now() < killer.zenyBuffUntil) zmult *= 2;
  killer.zeny += Math.round((t.zeny + Math.floor(Math.random() * t.zeny * 0.5)) * zmult);
  broadcast({ t: 'event', kind: 'mdeath', id: m.id, x: m.x, y: m.y, killer: killer.id, zeny: t.zeny });
  if (t.boss) broadcast({ t: 'event', kind: 'boss', text: killer.name + ' has slain ' + t.name + '! It will return in 10 minutes...' });
  // rare equipment drop (drop-gear beats shop gear: tiers scale with monster level)
  const dropCh = t.mvp ? 0.5 : t.boss ? 0.25 : 0.02;
  if (Math.random() < dropCh && killer.eq.inv.length < INV_MAX) {
    const kind = ['w', 'a', 's', 'x'][Math.floor(Math.random() * 4)];
    let tier;
    if (t.lvl >= 40) tier = Math.random() < 0.5 ? 5 : 4;
    else if (t.lvl >= 16) tier = Math.random() < 0.5 ? 4 : 3;
    else if (t.lvl >= 6) tier = Math.random() < 0.6 ? 3 : 2;
    else tier = Math.random() < 0.6 ? 2 : 1;
    const it = newItem(kind, tier);
    killer.eq.inv.push(it);
    broadcast({ t: 'event', kind: 'lootdrop', id: killer.id, item: itemName(it), tier, x: Math.round(m.x), y: Math.round(m.y) });
    if (tier >= 4) broadcast({ t: 'event', kind: 'boss', text: '✨ ' + killer.name + ' looted ' + itemName(it) + '!' });
    sendInv(killer);
  }
  // card drop roll
  const card = CARDS[m.type];
  if (card && Math.random() < card.drop) {
    killer.eq.cards[m.type] = (killer.eq.cards[m.type] || 0) + 1;
    broadcast({ t: 'event', kind: 'carddrop', id: killer.id, card: card.name, boss: !!t.boss, x: Math.round(m.x), y: Math.round(m.y) });
    if (t.boss) broadcast({ t: 'event', kind: 'boss', text: '💎 ' + killer.name + ' obtained the legendary ' + card.name + '!!!' });
  }
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
        m.hp = t.hp; m.dead = false; m.target = null; m.slowUntil = 0; m.enraged = false; m.shieldUntil = 0;
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
        const raw = Math.max(1, Math.floor((t.atk + Math.floor(Math.random() * 6) - 2) * (m.enraged ? 1.5 : 1)));
        if (monsterHitsPlayer(m, tgt, raw)) killPlayer(tgt, m);
      }
      // ---- monster skills (while chasing) ----
      const ms = MOB_SKILLS[m.type];
      if (ms && now > (m.skillAt || 0)) {
        m.skillAt = now + ms.cd;
        const fxMsg = { t: 'event', kind: 'skillfx', id: m.id, skill: ms.fx, x: Math.round(m.x), y: Math.round(m.y) };
        if (m.type === 'jelly') {
          m.hp = Math.min(t.hp, m.hp + 15); broadcast(fxMsg);
        } else if (m.type === 'bluejelly' && d < 140) {
          fxMsg.x = Math.round(tgt.x); fxMsg.y = Math.round(tgt.y); broadcast(fxMsg);
          if (monsterHitsPlayer(m, tgt, Math.floor(t.atk * 1.2))) killPlayer(tgt, m);
        } else if (m.type === 'mushy') {
          broadcast(fxMsg);
          for (const pid in players) { const pl = players[pid]; if (!pl.dead && Math.hypot(pl.x - m.x, pl.y - m.y) < 85) { if (monsterHitsPlayer(m, pl, Math.floor(t.atk * 0.7))) killPlayer(pl, m); } }
        } else if (m.type === 'wolf' && d > 60 && d < 220) {
          if (!isBlocked(tgt.x + 26, tgt.y)) { m.x = tgt.x + 26; m.y = tgt.y; }
          fxMsg.x = Math.round(m.x); fxMsg.y = Math.round(m.y); broadcast(fxMsg);
          if (monsterHitsPlayer(m, tgt, Math.floor(t.atk * 1.1))) killPlayer(tgt, m);
        } else if (m.type === 'skeleton' && d < 170) {
          fxMsg.x = Math.round(tgt.x); fxMsg.y = Math.round(tgt.y); broadcast(fxMsg);
          if (monsterHitsPlayer(m, tgt, Math.floor(t.atk * 1.3))) killPlayer(tgt, m);
        } else if (m.type === 'ghoul' && d < 90) {
          fxMsg.x = Math.round(tgt.x); fxMsg.y = Math.round(tgt.y); broadcast(fxMsg);
          const dd = Math.floor(t.atk * 1.0);
          m.hp = Math.min(t.hp, m.hp + dd);
          if (monsterHitsPlayer(m, tgt, dd)) killPlayer(tgt, m);
        } else if (m.type === 'crab') {
          m.shieldUntil = now + 4000; broadcast(fxMsg);
        } else if (m.type === 'siren') {
          broadcast(fxMsg);
          for (const pid in players) { const pl = players[pid]; if (!pl.dead && Math.hypot(pl.x - m.x, pl.y - m.y) < 105) { if (monsterHitsPlayer(m, pl, Math.floor(t.atk * 0.8))) killPlayer(pl, m); } }
        } else if (m.type === 'direking') {
          broadcast(fxMsg);
          for (const pid in players) { const pl = players[pid]; if (!pl.dead && Math.hypot(pl.x - m.x, pl.y - m.y) < 120) { if (monsterHitsPlayer(m, pl, Math.floor(t.atk * 1.0))) killPlayer(pl, m); } }
        }
      }
      // ---- SOLARIS MVP rotation: flare + beam + enrage + regeneration ----
      if (t.mvp) {
        if (!m.enraged && m.hp < t.hp * 0.5) {
          m.enraged = true;
          broadcast({ t: 'event', kind: 'boss', text: '🔥 SOLARIS ENRAGES! The sun burns hotter!!' });
          broadcast({ t: 'event', kind: 'skillfx', id: m.id, skill: 'warcry', x: Math.round(m.x), y: Math.round(m.y) });
        }
        const rage = m.enraged ? 1.5 : 1;
        if (now > (m.flareAt || 0)) {
          m.flareAt = now + (m.enraged ? 6000 : 8000);
          broadcast({ t: 'event', kind: 'skillfx', id: m.id, skill: 'inferno', x: Math.round(m.x), y: Math.round(m.y) });
          for (const pid in players) { const pl = players[pid]; if (!pl.dead && Math.hypot(pl.x - m.x, pl.y - m.y) < 130) { if (monsterHitsPlayer(m, pl, Math.floor(t.atk * 2 * rage))) killPlayer(pl, m); } }
        }
        if (now > (m.beamAt || 0) && d < 260) {
          m.beamAt = now + (m.enraged ? 4000 : 5000);
          broadcast({ t: 'event', kind: 'skillfx', id: m.id, skill: 'jupitel', x: Math.round(tgt.x), y: Math.round(tgt.y) });
          if (monsterHitsPlayer(m, tgt, Math.floor(t.atk * 2.5 * rage))) killPlayer(tgt, m);
        }
        if (!m.enraged && now > (m.healAt || 0)) {
          m.healAt = now + 10000;
          if (m.hp < t.hp) {
            m.hp = Math.min(t.hp, m.hp + 400);
            broadcast({ t: 'event', kind: 'skillfx', id: m.id, skill: 'goldrush', x: Math.round(m.x), y: Math.round(m.y) });
          }
        }
      }
      // boss stomp: AoE every 6s
      if (t.boss && now - m.lastStomp > 6000) {
        m.lastStomp = now;
        let any = false;
        for (const pid in players) {
          const p = players[pid];
          if (p.dead) continue;
          if (Math.hypot(p.x - m.x, p.y - m.y) < 100) {
            any = true;
            if (monsterHitsPlayer(m, p, Math.max(1, Math.floor(t.atk * 0.8)))) killPlayer(p, m);
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
      p.protectUntil = now + 4000; // brief PvP protection after respawn
      broadcast({ t: 'event', kind: 'respawn', id: p.id });
    }
    if (!p.dead && p.hp < p.maxHp && now % 3000 < 120) p.hp = Math.min(p.maxHp, p.hp + 2 + Math.floor(p.level / 2) + cardEff(p, 'a', 'regen') * 3 + Math.round((p.regenBonus || 0) * 3));
    // GOREHORN armor card: fire aura burns nearby monsters (once per second)
    if (!p.dead && cardEff(p, 'a', 'aura') > 0 && now % 1000 < 120) {
      const burn = cardEff(p, 'a', 'aura');
      monstersInRange(p.x, p.y, 90).forEach(m => {
        m.hp -= burn;
        m.target = p.id;
        broadcast({ t: 'event', kind: 'hit', from: p.id, target: m.id, dmg: burn, tx: Math.round(m.x), ty: Math.round(m.y), cls: 'aura' });
        if (m.hp <= 0) killMonster(m, p);
      });
    }
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
  const w = equippedItem(p, 'w'), a = equippedItem(p, 'a');
  return {
    id: p.id, n: p.name, c: p.cls, x: Math.round(p.x), y: Math.round(p.y),
    d: p.dir, mv: p.moving, hp: p.hp, mh: p.maxHp, lv: p.level,
    xp: p.xp, xn: xpNeeded(p.level), z: p.zeny, dead: p.dead, b: isBuffed(p) ? 1 : 0,
    eq: [w ? w.t : 0, w ? w.p : 0, a ? a.t : 0, a ? a.p : 0], po: [p.eq.red, p.eq.white],
    wc: w ? w.c : null, ac: a ? a.c : null, cd: p.eq.cards, adv: p.adv || 0,
    spm: 1 + cardEff(p, 'a', 'spd'), au: cardEff(p, 'a', 'aura') > 0 ? 1 : 0
  };
}

server.listen(PORT, () => {
  console.log('=========================================');
  console.log('  007 ONLINE - server started');
  console.log(`  Local play:  http://localhost:${PORT}`);
  console.log('=========================================');
});
