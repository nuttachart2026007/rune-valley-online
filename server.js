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
// ---- ZOMBIE MANIA graveyard island (bridge across the sea from the beach) ----
MAP[MAP.length - 1][24] = 'c'; MAP[MAP.length - 1][25] = 'c';   // bridge over the sea
MAP.push(('s'.repeat(24) + 'cc' + 's'.repeat(26)).split(''));    // crypt gate
for (let i = 0; i < 16; i++) MAP.push(('s' + 'g'.repeat(50) + 's').split(''));  // expanded graveyard
MAP.push('s'.repeat(52).split(''));
// tombstones
[[8,58],[16,61],[24,59],[32,63],[40,60],[12,64],[36,57],[44,64],[20,57],
 [10,68],[22,70],[34,67],[42,71],[6,71],[28,69],[46,68],[16,72],[38,72]].forEach(([x,y]) => { if (MAP[y] && MAP[y][x] === 'g') MAP[y][x] = 's'; });
// ---- 100F HELL & HEAVEN tower (gate at the south end of the graveyard) ----
MAP[MAP.length - 1][24] = 'c'; MAP[MAP.length - 1][25] = 'c';   // tower gate through the wall
MAP.push(('s'.repeat(24) + 'cc' + 's'.repeat(26)).split(''));    // entrance hall
for (let i = 0; i < 7; i++) MAP.push(('s' + 'h'.repeat(50) + 's').split(''));  // HELL floors (1-50)
for (let i = 0; i < 7; i++) MAP.push(('s' + 'v'.repeat(50) + 's').split(''));  // HEAVEN floors (51-100)
MAP.push('s'.repeat(52).split(''));
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
const HEAD_TIERS   = [0, 30, 70, 140, 220, 320];        // max HP bonus
const BOOT_TIERS   = [0, 0.03, 0.05, 0.08, 0.12, 0.16]; // move speed%
const TIER_NAMES = {
  w: ['-', 'Iron', 'Steel', 'Runic', 'Valkyrie', 'Celestial'],
  a: ['-', 'Leather', 'Chain', 'Runic', 'Valkyrie', 'Celestial'],
  s: ['-', 'Buckler', 'Kite', 'Tower', 'Valkyrie', 'Celestial'],
  x: ['-', 'Ring', 'Amulet', 'Talisman', 'Relic', 'Celestial'],
  h: ['-', 'Cap', 'Helm', 'Circlet', 'Valkyrie', 'Celestial'],
  b: ['-', 'Sandals', 'Boots', 'Greaves', 'Valkyrie', 'Celestial']
};
const KIND_NAMES = { w: 'Weapon', a: 'Armor', s: 'Shield', x: 'Accessory', h: 'Headgear', b: 'Shoes' };
const EQUIP_SLOTS = ['w', 'a', 's', 'h', 'b', 'x1', 'x2'];
// rarity: 0 Normal, 1 Rare, 2 Epic, 3 Legendary (MVP only), 4 MULTIVERSE (HELL & HEAVEN gods only, x3 stats)
const RARITY_NAMES = ['', 'Rare ', 'Epic ', 'Legendary ', 'MULTIVERSE '];
const RARITY_MULT = [1, 1.25, 1.5, 2, 3];
const INV_MAX = 24;
function newItem(kind, tier, rarity) { return { id: Math.random().toString(36).slice(2, 9), k: kind, t: tier, p: 0, c: null, cs: 0, r: rarity || 0 }; }
function itemName(it) { return RARITY_NAMES[it.r || 0] + TIER_NAMES[it.k][it.t] + ' ' + KIND_NAMES[it.k] + (it.p ? ' +' + it.p : ''); }
const SHOP_ITEMS = {
  w1: { kind: 'w', tier: 1, price: 200 },  w2: { kind: 'w', tier: 2, price: 800 },  w3: { kind: 'w', tier: 3, price: 2500 },
  a1: { kind: 'a', tier: 1, price: 200 },  a2: { kind: 'a', tier: 2, price: 800 },  a3: { kind: 'a', tier: 3, price: 2500 },
  s1: { kind: 's', tier: 1, price: 200 },  s2: { kind: 's', tier: 2, price: 800 },
  h1: { kind: 'h', tier: 1, price: 200 },  h2: { kind: 'h', tier: 2, price: 800 },
  b1: { kind: 'b', tier: 1, price: 200 },  b2: { kind: 'b', tier: 2, price: 800 },
  red: { pot: 'red', price: 15 },          white: { pot: 'white', price: 60 }
};
// card star upgrades: consume 1 duplicate card + zeny per attempt, +15% effect per star
function cardStarCost(stars) { return 200 * (stars + 1); }
function cardStarChance(stars) { return Math.pow(0.85, stars); }
function starMult(cs) { return 1 + 0.15 * Math.max(0, (cs || 1) - 1); }
// stat effects per point: STR +1 atk | VIT +8 HP, +0.2 regen | AGI +0.5% aspd, +0.2% dodge | DEX +0.4% crit | INT +0.8% damage
const STAT_KEYS = ['str', 'vit', 'agi', 'dex', 'int'];
const MAX_PLUS = 15;

// ---------------- CARDS (RO-style monster card drops) ----------------
// w = effect when slotted in weapon, a = effect when slotted in armor
const CARDS = {
  jelly:     { name: 'Jelly Card',      w: { atk: 4 },       a: { hp: 40 },              drop: 0.02  },
  bluejelly: { name: 'Blue Jelly Card', w: { aspd: 0.10 },   a: { regen: 3 },            drop: 0.016 },
  mushy:     { name: 'Mushy Card',      w: { dmg: 0.12 },    a: { dr: 0.10 },            drop: 0.016 },
  wolf:      { name: 'Dire Wolf Card',  w: { crit: 0.08 },   a: { spd: 0.10 },           drop: 0.014 },
  skeleton:  { name: 'Skeleton Card',   w: { ls: 0.08 },     a: { dodge: 0.10 },         drop: 0.012 },
  ghoul:     { name: 'Ghoul Card',      w: { pvp: 0.15 },    a: { hp: 100, dr: 0.05 },   drop: 0.012 },
  direking:  { name: 'GOREHORN CARD',   w: { meteor: 0.10 }, a: { aura: 15 },            drop: 0.10  },
  crab:      { name: 'Tide Crab Card',  w: { atk: 8 },       a: { hp: 60, dr: 0.05 },    drop: 0.016 },
  siren:     { name: 'Siren Card',      w: { aspd: 0.12 },   a: { regen: 5 },            drop: 0.014 },
  solaris:   { name: 'SOLARIS CARD',    w: { solar: 0.15 },  a: { hp: 200, regen: 5, spd: 0.05 }, drop: 0.12 },
  zombie:    { name: 'Zombie Card',     w: { dmg: 0.18 },    a: { hp: 150, dr: 0.05 },   drop: 0.012 },
  plague:    { name: 'Plaguebearer Card', w: { ls: 0.12 },   a: { regen: 8 },            drop: 0.01  },
  necrolord: { name: 'NECROLORD CARD',  w: { dmg: 0.25, ls: 0.10 }, a: { hp: 300, dr: 0.10 }, drop: 0.12 },
  demon:     { name: 'Demon Card',      w: { dmg: 0.20, pvp: 0.10 }, a: { hp: 200 },          drop: 0.01 },
  cherub:    { name: 'Cherub Card',     w: { aspd: 0.15 },   a: { regen: 12, hp: 150 },       drop: 0.01 },
  inferno:   { name: 'INFERNO CARD',    w: { meteor: 0.20, dmg: 0.20 }, a: { aura: 25 },      drop: 0.08 },
  seraphim:  { name: 'SERAPHIM CARD',   w: { ls: 0.15, dmg: 0.15 }, a: { hp: 500, regen: 15, dr: 0.05 }, drop: 0.08 },
  chronos:   { name: 'CHRONOS CARD',    w: { dmg: 0.40, solar: 0.10 }, a: { hp: 400, dr: 0.12, spd: 0.08 }, drop: 0.08 },
  celestial: { name: 'CELESTIAL CARD',  w: { dmg: 0.60 }, a: { hp: 800, dr: 0.15, regen: 20 }, drop: 0.06 },
  // HERO CARDS: dropped by players in PvP (15% on kill), effect depends on the fallen hero's class
  hero_swordsman: { name: 'HERO CARD · Swordsman', w: { atk: 15, dmg: 0.05 }, a: { hp: 150, dr: 0.03 } },
  hero_archer:    { name: 'HERO CARD · Archer',    w: { aspd: 0.12, crit: 0.05 }, a: { dodge: 0.08 } },
  hero_mage:      { name: 'HERO CARD · Mage',      w: { dmg: 0.15 },        a: { regen: 6 } },
  hero_thief:     { name: 'HERO CARD · Thief',     w: { crit: 0.10 },       a: { spd: 0.10, dodge: 0.05 } },
  hero_merchant:  { name: 'HERO CARD · Merchant',  w: { atk: 10 },          a: { hp: 100, zeny: 0.15 } }
};
function cardEff(p, side, key) {
  // weapon/accessory sockets use card w-effects; armor/shield/head/shoes use a-effects; ★ stars amplify
  let v = 0;
  for (const sl of (side === 'w' ? ['w', 'x1', 'x2'] : ['a', 's', 'h', 'b'])) {
    const id = p.eq.eqp ? p.eq.eqp[sl] : null;
    if (!id) continue;
    const it = p.eq.inv.find(i => i.id === id);
    if (it && it.c && CARDS[it.c]) v += ((side === 'w' ? CARDS[it.c].w : CARDS[it.c].a)[key] || 0) * starMult(it.cs);
  }
  return v;
}
function upgradeCost(cur) { return Math.round(100 * Math.pow(1.6, cur)); }
function upgradeChance(cur) { return Math.pow(0.8, cur); } // 80% at +0, ~13% at +9
function inTown(p) { return p.x >= 8 * TILE && p.x <= 18 * TILE && p.y >= 3 * TILE && p.y <= 8 * TILE; }
function defaultEq() { return { red: 0, white: 0, cards: {}, inv: [], eqp: { w: null, a: null, s: null, h: null, b: null, x1: null, x2: null } }; }
function migrateEq(eq) {
  if (!eq) return defaultEq();
  if (eq.inv) {
    const oldEqp = eq.eqp || {};
    eq.eqp = { w: oldEqp.w || null, a: oldEqp.a || null, s: oldEqp.s || null, h: oldEqp.h || null, b: oldEqp.b || null, x1: oldEqp.x1 || oldEqp.x || null, x2: oldEqp.x2 || null };
    eq.cards = eq.cards || {};
    eq.inv.forEach(it => { if (it.r === undefined) it.r = 0; if (it.cs === undefined) it.cs = it.c ? 1 : 0; });
    return eq;
  }
  // legacy v5-format -> item inventory
  const ne = defaultEq();
  ne.red = eq.red || 0; ne.white = eq.white || 0; ne.cards = eq.cards || {};
  if (eq.wt) { const it = newItem('w', eq.wt); it.p = eq.wp || 0; it.c = eq.wc || null; it.cs = it.c ? 1 : 0; ne.inv.push(it); ne.eqp.w = it.id; }
  if (eq.at) { const it = newItem('a', eq.at); it.p = eq.ap || 0; it.c = eq.ac || null; it.cs = it.c ? 1 : 0; ne.inv.push(it); ne.eqp.a = it.id; }
  return ne;
}
function equippedItem(p, slot) {
  const id = p.eq.eqp[slot];
  return id ? p.eq.inv.find(i => i.id === id) || null : null;
}
function recalcStats(p) {
  const base = statsForLevel(p.cls, p.level);
  const ratio = p.maxHp ? Math.min(1, p.hp / p.maxHp) : 1;
  const w = equippedItem(p, 'w'), a = equippedItem(p, 'a'), s = equippedItem(p, 's');
  const h = equippedItem(p, 'h'), b = equippedItem(p, 'b');
  const x1 = equippedItem(p, 'x1'), x2 = equippedItem(p, 'x2');
  // MULTIVERSE AWAKENING: a Multiverse item refined to +15 jumps from x3 to x4.5 power
  const rm = it => it ? RARITY_MULT[it.r || 0] * (it.r === 4 && it.p >= 15 ? 1.5 : 1) : 1;
  const st = p.st;
  p.atk = base.atk + st.str + (w ? Math.round(WEAPON_TIERS[w.t] * rm(w)) + w.p * 3 : 0) + cardEff(p, 'w', 'atk') + (p.adv ? 5 : 0);
  p.maxHp = base.maxHp + st.vit * 8
    + (a ? Math.round(ARMOR_TIERS[a.t] * rm(a)) + a.p * 25 : 0)
    + (h ? Math.round(HEAD_TIERS[h.t] * rm(h)) + h.p * 15 : 0)
    + (s ? s.p * 20 : 0)
    + cardEff(p, 'a', 'hp') + (p.adv ? 60 : 0);
  p.drBonus = (s ? SHIELD_TIERS[s.t] * rm(s) + s.p * 0.005 : 0);
  p.dmgBonus = (x1 ? ACC_TIERS[x1.t] * rm(x1) + x1.p * 0.005 : 0) + (x2 ? ACC_TIERS[x2.t] * rm(x2) + x2.p * 0.005 : 0) + st.int * 0.008;
  p.spdBonus = (b ? BOOT_TIERS[b.t] * rm(b) + b.p * 0.004 : 0);
  p.aspdBonus = st.agi * 0.005;
  p.dodgeBonus = st.agi * 0.002;
  p.critBonus = st.dex * 0.004;
  p.regenBonus = st.vit * 0.2;
  p.hp = Math.max(1, Math.round(p.maxHp * ratio));
}
// skill defs: unlock level, cooldown ms, behavior handled in useSkill()
// v10: at Lv30 every class CHOOSES one of two job paths - each path has its own 3 advanced skills
const ADV_PATHS = {
  swordsman: ['Knight', 'Paladin'],
  archer:    ['Sniper', 'Ranger'],
  mage:      ['Wizard', 'Sage'],
  thief:     ['Assassin', 'Ninja'],
  merchant:  ['Tycoon', 'Alchemist']
};
const ADV_NAMES = { swordsman: 'Knight', archer: 'Sniper', mage: 'Wizard', thief: 'Assassin', merchant: 'Tycoon' }; // legacy
const BASE_SKILLS = {
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
  ],
  thief: [
    { key: 'dbl',       name: 'Double Attack', lvl: 3,  cd: 4000 },
    { key: 'backstab',  name: 'Backstab',      lvl: 6,  cd: 8000 },
    { key: 'shadow',    name: 'Shadow Dash',   lvl: 10, cd: 12000 }
  ],
  merchant: [
    { key: 'mammonite', name: 'Mammonite',    lvl: 3,  cd: 5000 },
    { key: 'cointoss',  name: 'Coin Toss',    lvl: 6,  cd: 8000 },
    { key: 'greed',     name: 'Greed Aura',   lvl: 10, cd: 20000 }
  ]
};
const PATH_SKILLS = {
  swordsman: [
    [ // Knight
      { key: 'bbash',     name: 'Bowling Bash', lvl: 30, cd: 8000 },
      { key: 'quicken',   name: 'Quicken',      lvl: 35, cd: 20000 },
      { key: 'lordaura',  name: 'Lord Strike',  lvl: 40, cd: 15000 }
    ],
    [ // Paladin
      { key: 'shieldboom', name: 'Shield Boomerang', lvl: 30, cd: 8000 },
      { key: 'sanctuary',  name: 'Sanctuary',        lvl: 35, cd: 18000 },
      { key: 'gcross',     name: 'Grand Cross',      lvl: 40, cd: 15000 }
    ]
  ],
  archer: [
    [ // Sniper
      { key: 'focus',     name: 'Focused Arrow', lvl: 30, cd: 10000 },
      { key: 'astorm',    name: 'Arrow Storm',   lvl: 35, cd: 12000 },
      { key: 'truesight', name: 'True Sight',    lvl: 40, cd: 25000 }
    ],
    [ // Ranger
      { key: 'blasttrap', name: 'Blast Trap',     lvl: 30, cd: 9000 },
      { key: 'falcon',    name: 'Falcon Assault', lvl: 35, cd: 13000 },
      { key: 'camo',      name: 'Camouflage',     lvl: 40, cd: 25000 }
    ]
  ],
  mage: [
    [ // Wizard
      { key: 'jupitel',   name: 'Jupitel',      lvl: 30, cd: 8000 },
      { key: 'stormgust', name: 'Storm Gust',   lvl: 35, cd: 14000 },
      { key: 'inferno',   name: 'Hell Inferno', lvl: 40, cd: 16000 }
    ],
    [ // Sage
      { key: 'soulstrike', name: 'Soul Strike',  lvl: 30, cd: 8000 },
      { key: 'quagmire',   name: 'Quagmire',     lvl: 35, cd: 12000 },
      { key: 'lifepsy',    name: 'Life Psychic', lvl: 40, cd: 20000 }
    ]
  ],
  thief: [
    [ // Assassin
      { key: 'sonic',     name: 'Sonic Blow',    lvl: 30, cd: 10000 },
      { key: 'venom',     name: 'Venom Edge',    lvl: 35, cd: 12000 },
      { key: 'crossimpact', name: 'Cross Impact', lvl: 40, cd: 15000 }
    ],
    [ // Ninja
      { key: 'huuma',     name: 'Huuma Shuriken', lvl: 30, cd: 9000 },
      { key: 'kage',      name: 'Shadow Clone',   lvl: 35, cd: 12000 },
      { key: 'smoke',     name: 'Smoke Bomb',     lvl: 40, cd: 25000 }
    ]
  ],
  merchant: [
    [ // Tycoon
      { key: 'cartterm',  name: 'Cart Cannon',  lvl: 30, cd: 10000 },
      { key: 'goldrush',  name: 'Gold Rush',    lvl: 35, cd: 25000 },
      { key: 'meltdown',  name: 'Meltdown',     lvl: 40, cd: 14000 }
    ],
    [ // Alchemist
      { key: 'acid',      name: 'Acid Terror',  lvl: 30, cd: 9000 },
      { key: 'sphere',    name: 'Alchemy Blast', lvl: 35, cd: 12000 },
      { key: 'prain',     name: 'Potion Rain',  lvl: 40, cd: 18000 }
    ]
  ]
};
const ULT_SKILLS = {
  swordsman: { key: 'ragnarok',  name: 'RAGNAROK',     lvl: 99, cd: 30000 },
  archer:    { key: 'arrowgod',  name: 'Arrow of Gods', lvl: 99, cd: 30000 },
  mage:      { key: 'meteorstorm', name: 'Meteor Storm', lvl: 99, cd: 30000 },
  thief:     { key: 'deathdance', name: 'Death Dance',  lvl: 99, cd: 30000 },
  merchant:  { key: 'midas',     name: 'Midas Wrath',  lvl: 99, cd: 30000 }
};
function skillsFor(p) {
  return BASE_SKILLS[p.cls].concat(PATH_SKILLS[p.cls][(p.adv || 1) - 1], [ULT_SKILLS[p.cls]]);
}
function skillsMsg(p) {
  return skillsFor(p).map(s => ({ key: s.key, name: s.name, lvl: s.lvl, cd: s.cd }));
}

// ---------------- MONSTERS (v2: harder + aggressive) ----------------
const MONSTER_TYPES = {
  jelly:     { name: 'Jelly',       hp: 80,   atk: 8,  xp: 14,   zeny: 9,    speed: 0.9, aggro: 80,  lvl: 2  },
  bluejelly: { name: 'Blue Jelly',  hp: 180,  atk: 18, xp: 45,   zeny: 26,   speed: 1.2, aggro: 150, lvl: 6  },
  mushy:     { name: 'Mushy',       hp: 330,  atk: 30, xp: 90,   zeny: 60,   speed: 0.9, aggro: 170, lvl: 10 },
  wolf:      { name: 'Dire Wolf',   hp: 680,  atk: 45, xp: 220,  zeny: 135,  speed: 1.9, aggro: 220, lvl: 15 },
  skeleton:  { name: 'Skeleton',    hp: 950,  atk: 55, xp: 380,  zeny: 210,  speed: 1.5, aggro: 240, lvl: 20 },
  ghoul:     { name: 'Ghoul',       hp: 1400, atk: 70, xp: 600,  zeny: 330,  speed: 1.2, aggro: 260, lvl: 25 },
  direking:  { name: 'GOREHORN the Dire King', hp: 60000, atk: 200, xp: 15000, zeny: 15000, speed: 1.9, aggro: 320, lvl: 55, boss: true, mvp: true, armor: 0.35, enrageAt: 0.4 },
  crab:      { name: 'Tide Crab',   hp: 1200, atk: 60,  xp: 800,   zeny: 450,  speed: 1.0, aggro: 240, lvl: 26 },
  siren:     { name: 'Siren',       hp: 1800, atk: 80,  xp: 1300,  zeny: 700,  speed: 1.3, aggro: 260, lvl: 32 },
  solaris:   { name: 'SOLARIS the Sun Tyrant', hp: 200000, atk: 300, xp: 50000, zeny: 50000, speed: 2.0, aggro: 340, lvl: 80, boss: true, mvp: true, armor: 0.5, enrageAt: 0.5 },
  zombie:    { name: 'Zombie',      hp: 2500, atk: 90,  xp: 2000,  zeny: 900,  speed: 0.9, aggro: 260, lvl: 38 },
  plague:    { name: 'Plaguebearer', hp: 4200, atk: 115, xp: 3500, zeny: 1500, speed: 1.1, aggro: 280, lvl: 46 },
  necrolord: { name: 'NECROLORD the Grave King', hp: 120000, atk: 260, xp: 35000, zeny: 35000, speed: 1.6, aggro: 340, lvl: 85, boss: true, mvp: true, armor: 0.45, enrageAt: 0.45 },
  // ---- 100F HELL & HEAVEN tower ----
  demon:     { name: 'Hell Demon',   hp: 9000,  atk: 170, xp: 6000,  zeny: 2500, speed: 1.4, aggro: 300, lvl: 60 },
  cherub:    { name: 'Fallen Cherub', hp: 12000, atk: 190, xp: 8000, zeny: 3200, speed: 1.6, aggro: 300, lvl: 68 },
  inferno:   { name: 'INFERNO, Lord of Hell',    hp: 500000, atk: 400, xp: 120000, zeny: 120000, speed: 1.8, aggro: 360, lvl: 99, boss: true, mvp: true, superMvp: true, armor: 0.5, enrageAt: 0.5 },
  seraphim:  { name: 'SERAPHIM, the Divine Judge', hp: 500000, atk: 380, xp: 120000, zeny: 120000, speed: 1.7, aggro: 360, lvl: 99, boss: true, mvp: true, superMvp: true, armor: 0.55, enrageAt: 0.4 },
  chronos:   { name: 'CHRONOS, God of the 100 Floors', hp: 800000, atk: 450, xp: 250000, zeny: 250000, speed: 1.9, aggro: 380, lvl: 99, boss: true, mvp: true, superMvp: true, armor: 0.6, enrageAt: 0.5 },
  celestial: { name: 'THE CELESTIAL, God of Gods', hp: 2000000, atk: 1000, aoeDmg: 5000, xp: 600000, zeny: 600000, speed: 1.4, aggro: 420, lvl: 99, boss: true, mvp: true, superMvp: true, armor: 0.65, enrageAt: 0.5 }
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
  direking:  { cd: 12000, fx: 'bbash' },      // dire roar: heavy AoE
  zombie:    { cd: 8000,  fx: 'venom' },      // infected bite: damage + self heal
  plague:    { cd: 9000,  fx: 'frostnova' },  // plague cloud: AoE sickness
  demon:     { cd: 7000,  fx: 'firebolt' },   // hellfire bolt: ranged burn
  cherub:    { cd: 8000,  fx: 'jupitel' }     // divine spark: ranged smite + self heal
  // MVPs have their own rotation below
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
  ['solaris',   1, 28, 48, 37, 54],
  ['zombie',   10, 2,  57, 48, 72],
  ['plague',    5, 20, 57, 48, 72],
  ['necrolord', 1, 30, 64, 46, 71],
  ['demon',     7, 2,  75, 48, 81],
  ['inferno',   1, 4,  76, 20, 80],
  ['cherub',    7, 2,  82, 48, 88],
  ['seraphim',  1, 32, 83, 46, 87],
  ['chronos',   1, 18, 84, 32, 88],
  ['celestial', 1, 4,  83, 16, 88]
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
  return { name: p.name, cls: p.cls, level: p.level, xp: p.xp, zeny: p.zeny, eq: p.eq, st: p.st, sp: p.sp, adv: p.adv || 0, home: p.home || null, pk: p.pk || 0, pinHash: p.pinHash, seen: Date.now() };
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
    home: restore ? (restore.home || null) : null,
    pk: restore ? (restore.pk || 0) : 0,
    party: null,
    lastAtk: 0, lastPot: 0, skillCd: [0, 0, 0, 0, 0, 0, 0], buffUntil: 0, zenyBuffUntil: 0,
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
    // 2nd job: at Lv30 the player CHOOSES between two paths
    if (p.level >= 30 && !p.adv) {
      send(p.ws, { t: 'jobchoice', options: ADV_PATHS[p.cls] });
    }
    // LEVEL 99 ASCENSION: lightning + ultimate skill unlocked
    if (p.level === 99) {
      broadcast({ t: 'event', kind: 'boss', text: '⚡⚡ ' + p.name + ' HAS REACHED LEVEL 99!! THE HEAVENS ROAR — ULTIMATE SKILL UNLOCKED! ⚡⚡' });
      broadcast({ t: 'event', kind: 'ascend', id: p.id, x: Math.round(p.x), y: Math.round(p.y) });
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
  // v12: gods can be fought by anyone - no party requirement (parties still share XP + protect each other)
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
  if (inHome(p)) return false;   // safe at home - monsters can't hurt you
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

// ---------------- HOME (safe zone bought with zeny) ----------------
const HOME_COST = 100000;
const HOME_R = 64;          // safe radius around own home
const HOME_SHELTER_MS = 60000; // shelter lasts max 1 minute per visit (no camping from bosses!)
function inHome(p) {
  const inside = !!(p.home && !p.dead && Math.hypot(p.x - p.home.x, p.y - p.home.y) < HOME_R);
  if (!inside) { p.homeSince = 0; p.homeWarned = false; return false; }
  if (!p.homeSince) p.homeSince = Date.now();
  if (Date.now() - p.homeSince > HOME_SHELTER_MS) {
    if (!p.homeWarned) { p.homeWarned = true; if (p.ws) sysMsg(p, '⚠️ Your home wards are EXHAUSTED (1 min limit)! You are no longer protected - step outside to recharge them.'); }
    return false;
  }
  return true;
}

// ---------------- PARTY SYSTEM ----------------
function sameParty(a, b) { return !!(a && b && a.party && a.party === b.party); }
function partyMembersNear(p, r) {
  const out = [p];
  if (!p.party) return out;
  for (const id in players) {
    const v = players[id];
    if (v.id !== p.id && !v.dead && sameParty(v, p) && Math.hypot(v.x - p.x, v.y - p.y) <= r) out.push(v);
  }
  return out;
}

// ---------------- PVP (players can fight each other everywhere - except at home / in party) ----------------
function pvpTargetable(v, attacker) {
  return v && !v.dead && v.id !== attacker.id && Date.now() >= v.protectUntil
    && !inHome(v) && !inHome(attacker)    // home = safe zone; also no attacking FROM home
    && !sameParty(v, attacker);           // party members never hurt each other
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
    // ---- PVP death penalty: killer takes 30% of zeny + 25% chance to steal a random item ----
    a.pk = (a.pk || 0) + 1;
    const stolen = Math.floor(v.zeny * 0.3);
    if (stolen > 0) {
      v.zeny -= stolen; a.zeny += stolen;
      broadcast({ t: 'event', kind: 'boss', text: '💰 ' + a.name + ' looted ' + stolen + 'z from ' + v.name + '!' });
    }
    // HERO CARD drop: 15% chance the fallen hero drops their class card
    if (Math.random() < 0.15) {
      const hc = 'hero_' + v.cls;
      a.eq.cards[hc] = (a.eq.cards[hc] || 0) + 1;
      broadcast({ t: 'event', kind: 'carddrop', id: a.id, card: CARDS[hc].name, boss: true, x: Math.round(v.x), y: Math.round(v.y) });
      broadcast({ t: 'event', kind: 'boss', text: '🃏 ' + v.name + ' dropped a ' + CARDS[hc].name + '!!' });
    }
    if (v.eq.inv.length > 0 && Math.random() < 0.25 && a.eq.inv.length < INV_MAX) {
      const idx = Math.floor(Math.random() * v.eq.inv.length);
      const it = v.eq.inv.splice(idx, 1)[0];
      for (const sl of EQUIP_SLOTS) if (v.eq.eqp[sl] === it.id) v.eq.eqp[sl] = null;
      a.eq.inv.push(it);
      recalcStats(v); recalcStats(a);
      broadcast({ t: 'event', kind: 'boss', text: '🗡️ ' + a.name + ' STOLE ' + itemName(it) + ' from ' + v.name + '!!' });
      sendInv(v); sendInv(a);
    }
    persist(a); persist(v);
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
  const defs = skillsFor(p);
  if (!defs || n < 0 || n > 6) return;
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
  } else if (def.key === 'shieldboom') {
    // Paladin: hurl your shield
    const t = nearestAny(p, c.range + 60);
    if (t) { const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y); hitAny(p, t, dmgRoll(p, 4)); used = true; }
  } else if (def.key === 'sanctuary') {
    // Paladin: holy ground heals you + party members nearby
    partyMembersNear(p, 140).forEach(v => {
      if (v.hp < v.maxHp) { v.hp = Math.min(v.maxHp, v.hp + 250); broadcast({ t: 'event', kind: 'heal', id: v.id, amt: 250, x: Math.round(v.x), y: Math.round(v.y) }); }
    });
    used = true;
  } else if (def.key === 'gcross') {
    // Paladin: Grand Cross
    used = aoe(p.x, p.y, 110, 4, false);
  } else if (def.key === 'blasttrap') {
    // Ranger: explosive trap under the target
    const t = nearestAny(p, 280);
    const o = t ? tgtPos(t) : p;
    fx.x = Math.round(o.x); fx.y = Math.round(o.y);
    used = aoe(o.x, o.y, 100, 3, true);
  } else if (def.key === 'falcon') {
    // Ranger: falcon dives from extreme range
    const t = nearestAny(p, 320);
    if (t) { const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y); hitAny(p, t, dmgRoll(p, 7)); used = true; }
  } else if (def.key === 'camo') {
    // Ranger: vanish - players can't target you for 5s
    p.protectUntil = now + 5000;
    used = true;
  } else if (def.key === 'soulstrike') {
    // Sage: barrage of spirit bolts
    const t = nearestAny(p, 250);
    if (t) { const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y); for (let i = 0; i < 5; i++) hitAny(p, t, dmgRoll(p, 1.2)); used = true; }
  } else if (def.key === 'quagmire') {
    // Sage: swamp field - damage + heavy slow
    const t = nearestAny(p, 280);
    const o = t ? tgtPos(t) : p;
    fx.x = Math.round(o.x); fx.y = Math.round(o.y);
    const ms = monstersInRange(o.x, o.y, 130);
    const ps = playersInRange(p, o.x, o.y, 130);
    ms.forEach(mm => { hitMonster(p, mm, dmgRoll(p, 1.5)); mm.slowUntil = now + 6000; });
    ps.forEach(vv => hitPlayer(p, vv, dmgRoll(p, 1.5)));
    used = ms.length + ps.length > 0;
  } else if (def.key === 'lifepsy') {
    // Sage: psychic self-heal 40% max HP
    const amt = Math.floor(p.maxHp * 0.4);
    p.hp = Math.min(p.maxHp, p.hp + amt);
    broadcast({ t: 'event', kind: 'heal', id: p.id, amt, x: Math.round(p.x), y: Math.round(p.y) });
    used = true;
  } else if (def.key === 'huuma') {
    // Ninja: giant shuriken explodes on the target
    const t = nearestAny(p, 240);
    const o = t ? tgtPos(t) : p;
    fx.x = Math.round(o.x); fx.y = Math.round(o.y);
    used = aoe(o.x, o.y, 100, 2.5, false);
  } else if (def.key === 'kage') {
    // Ninja: shadow clone teleport + flurry
    const t = nearestAny(p, 300);
    if (t) {
      const o = tgtPos(t);
      for (const [ox, oy] of [[-30,0],[30,0],[0,-30],[0,30],[-24,-24],[24,24]]) {
        if (!isBlocked(o.x + ox, o.y + oy)) { p.x = o.x + ox; p.y = o.y + oy; break; }
      }
      fx.x = Math.round(o.x); fx.y = Math.round(o.y);
      for (let i = 0; i < 6; i++) hitAny(p, t, dmgRoll(p, 1));
      used = true;
    }
  } else if (def.key === 'smoke') {
    // Ninja: smoke bomb - untargetable by players for 5s
    p.protectUntil = now + 5000;
    used = true;
  } else if (def.key === 'acid') {
    // Alchemist: acid terror
    const t = nearestAny(p, c.range + 40);
    if (t) { const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y); hitAny(p, t, dmgRoll(p, 5.5)); used = true; }
  } else if (def.key === 'sphere') {
    // Alchemist: alchemy blast around self
    used = aoe(p.x, p.y, 120, 3, false);
  } else if (def.key === 'prain') {
    // Alchemist: potion rain heals you + party members nearby
    partyMembersNear(p, 140).forEach(v => {
      if (v.hp < v.maxHp) { v.hp = Math.min(v.maxHp, v.hp + 250); broadcast({ t: 'event', kind: 'heal', id: v.id, amt: 250, x: Math.round(v.x), y: Math.round(v.y) }); }
    });
    used = true;
  } else if (def.key === 'ragnarok') {
    // ULTIMATE: cataclysmic blade storm around the Knight
    used = aoe(p.x, p.y, 150, 12, false);
    if (!used) used = true; // always fires with full visual
  } else if (def.key === 'arrowgod') {
    // ULTIMATE: divine arrow from extreme range
    const t = nearestAny(p, 350);
    if (t) { const o = tgtPos(t); fx.x = Math.round(o.x); fx.y = Math.round(o.y); for (let i = 0; i < 5; i++) hitAny(p, t, dmgRoll(p, 3.5)); used = true; }
  } else if (def.key === 'meteorstorm') {
    // ULTIMATE: apocalyptic meteor field + deep slow
    const t = nearestAny(p, 300);
    const o = t ? tgtPos(t) : p;
    fx.x = Math.round(o.x); fx.y = Math.round(o.y);
    used = aoe(o.x, o.y, 160, 10, true);
    if (!used) used = true;
  } else if (def.key === 'deathdance') {
    // ULTIMATE: teleport flurry of 12 strikes
    const t = nearestAny(p, 320);
    if (t) {
      const o = tgtPos(t);
      for (const [ox, oy] of [[-30,0],[30,0],[0,-30],[0,30],[-24,-24],[24,24]]) {
        if (!isBlocked(o.x + ox, o.y + oy)) { p.x = o.x + ox; p.y = o.y + oy; break; }
      }
      fx.x = Math.round(o.x); fx.y = Math.round(o.y);
      for (let i = 0; i < 12; i++) hitAny(p, t, dmgRoll(p, 1.3));
      used = true;
    }
  } else if (def.key === 'midas') {
    // ULTIMATE: golden shockwave (costs 300z) + greed surge
    if (p.zeny >= 300) {
      p.zeny -= 300;
      p.zenyBuffUntil = now + 10000;
      used = aoe(p.x, p.y, 140, 11, false);
      if (!used) used = true;
    }
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
        skills: skillsMsg(me),
        restored: !!restore
      });
      sendSave(me);
      sendInv(me);
      if (me.level >= 30 && !me.adv) send(ws, { t: 'jobchoice', options: ADV_PATHS[me.cls] });
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
      const maxDist = c.speed * (1 + cardEff(me, 'a', 'spd') + (me.spdBonus || 0)) * (dt / 16) + 12;
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
        if (it.k === 'x') {
          const slot = !me.eq.eqp.x1 ? 'x1' : (!me.eq.eqp.x2 ? 'x2' : 'x1');
          me.eq.eqp[slot] = it.id;
        } else {
          me.eq.eqp[it.k] = it.id;
        }
        recalcStats(me);
        send(ws, { t: 'shopnote', ok: true, msg: 'Equipped ' + itemName(it) });
      } else if (msg.action === 'unequip') {
        if (EQUIP_SLOTS.includes(msg.slot)) { me.eq.eqp[msg.slot] = null; recalcStats(me); }
      } else if (msg.action === 'drop') {
        const it = findItem(msg.item);
        if (!it) return;
        if (it.c) { me.eq.cards[it.c] = (me.eq.cards[it.c] || 0) + 1; } // card returned before item destroyed
        for (const sl of EQUIP_SLOTS) if (me.eq.eqp[sl] === it.id) me.eq.eqp[sl] = null;
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
        it.cs = 1; // fresh socket starts at 1 star
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
          if (it.p >= 15 && it.r === 4) broadcast({ t: 'event', kind: 'boss', text: '🌌🌌 ' + me.name + ' has AWAKENED the MULTIVERSE POWER of ' + itemName(it) + '!! (x4.5 stats + rainbow aura) 🌌🌌' });
          else if (it.p >= 8) broadcast({ t: 'event', kind: 'boss', text: me.name + ' refined ' + itemName(it) + '!' });
        } else {
          send(ws, { t: 'shopnote', ok: false, msg: 'FAILED... ' + cost + 'z gone. The anvil laughs.' });
        }
      } else if (msg.action === 'upcard') {
        // upgrade socketed card stars (1-10): consumes 1 duplicate card + zeny per attempt
        const it = findItem(msg.item);
        if (!it || !it.c) return;
        if ((it.cs || 1) >= 10) { send(ws, { t: 'shopnote', ok: false, msg: 'Card already at ★10!' }); return; }
        if (!(me.eq.cards[it.c] > 0)) { send(ws, { t: 'shopnote', ok: false, msg: 'Need a duplicate ' + CARDS[it.c].name + ' to upgrade' }); return; }
        const cost = cardStarCost(it.cs || 1);
        if (me.zeny < cost) { send(ws, { t: 'shopnote', ok: false, msg: 'Need ' + cost + 'z' }); return; }
        me.zeny -= cost;
        me.eq.cards[it.c]--; // duplicate consumed either way
        if (Math.random() < cardStarChance(it.cs || 1)) {
          it.cs = (it.cs || 1) + 1;
          recalcStats(me);
          send(ws, { t: 'shopnote', ok: true, msg: 'SUCCESS! ' + CARDS[it.c].name + ' is now ★' + it.cs + '!' });
          if (it.cs >= 7) broadcast({ t: 'event', kind: 'boss', text: me.name + ' upgraded ' + CARDS[it.c].name + ' to ★' + it.cs + '!' });
        } else {
          send(ws, { t: 'shopnote', ok: false, msg: 'FAILED... duplicate card and ' + cost + 'z consumed.' });
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
      const pvp = Object.values(saves)
        .filter(r => (r.pk || 0) > 0)
        .sort((a, b) => (b.pk || 0) - (a.pk || 0))
        .slice(0, 10)
        .map(r => ({ n: r.name, c: r.cls, lv: r.level, k: r.pk || 0 }));
      send(ws, { t: 'rank', top, pvp });
      return;
    }
    if (msg.t === 'jobsel') {
      const n = Number(msg.n);
      if (me.level >= 30 && !me.adv && (n === 1 || n === 2)) {
        me.adv = n;
        const title = ADV_PATHS[me.cls][n - 1];
        broadcast({ t: 'event', kind: 'boss', text: '⭐ ' + me.name + ' has advanced to ' + title.toUpperCase() + '!' });
        broadcast({ t: 'event', kind: 'levelup', id: me.id, level: me.level });
        recalcStats(me);
        me.hp = me.maxHp;
        send(ws, { t: 'skills', skills: skillsMsg(me) });
        persist(me); sendSave(me);
      }
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

function sysMsg(p, text) { send(p.ws, { t: 'event', kind: 'chat', id: 'sys', name: 'SYSTEM', text }); }

function handleChat(p, msg) {
  const text = String(msg.text || '').slice(0, 120).trim();
  if (!text) return;
  // ---- /build : build your home (safe zone) at your current spot ----
  if (text === '/build') {
    if (p.zeny < HOME_COST) { sysMsg(p, 'Building a home costs ' + HOME_COST + 'z - you have ' + p.zeny + 'z.'); return; }
    const tx = p.x / TILE, ty = p.y / TILE;
    if (tx >= 7 && tx <= 19 && ty >= 2 && ty <= 9) { sysMsg(p, 'Cannot build in town - walk somewhere outside first!'); return; }
    for (const id in players) {
      const o = players[id];
      if (o.id !== p.id && o.home && Math.hypot(o.home.x - p.x, o.home.y - p.y) < 120) { sysMsg(p, 'Too close to another home - move a bit further away.'); return; }
    }
    for (const nl in saves) {
      const r = saves[nl];
      if (r.name !== p.name && r.home && Math.hypot(r.home.x - p.x, r.home.y - p.y) < 120) { sysMsg(p, 'Too close to another home - move a bit further away.'); return; }
    }
    const rebuild = !!p.home;
    p.zeny -= HOME_COST;
    p.home = { x: Math.round(p.x), y: Math.round(p.y) };
    persist(p); sendSave(p);
    broadcast({ t: 'event', kind: 'boss', text: '🏠 ' + p.name + (rebuild ? ' moved their home!' : ' built a home! A new safe haven appears...') });
    return;
  }
  // ---- /party : team up! ----
  if (text === '/party' || text === '/party help') {
    if (p.party) {
      const members = Object.values(players).filter(v => sameParty(v, p) || v.id === p.id).map(v => v.name + ' Lv' + v.level);
      sysMsg(p, '⚑ Party [' + p.party + ']: ' + members.join(', '));
    } else {
      sysMsg(p, 'No party yet. /party create · /party join NAME · /party leave. Members share XP, never hurt each other, and can fight the gods!');
    }
    return;
  }
  if (text === '/party create') {
    p.party = p.name.toLowerCase();
    broadcast({ t: 'event', kind: 'boss', text: '⚑ ' + p.name + ' formed a party! Join with: /party join ' + p.name });
    return;
  }
  if (text === '/party leave') {
    p.party = null;
    sysMsg(p, 'You left the party.');
    return;
  }
  if (text.startsWith('/party join ')) {
    const nm = text.slice(12).trim().toLowerCase();
    const o = Object.values(players).find(v => v.name.toLowerCase() === nm);
    if (!o) { sysMsg(p, 'Player "' + nm + '" is not online.'); return; }
    if (o.id === p.id) { sysMsg(p, 'You cannot join yourself - ask a friend!'); return; }
    if (!o.party) o.party = o.name.toLowerCase();
    p.party = o.party;
    broadcast({ t: 'event', kind: 'boss', text: '⚑ ' + p.name + ' joined ' + o.name + "'s party!" });
    return;
  }
  // admin commands (only the admin hero, protected by their PIN)
  if (text.startsWith('/') && p.name.toLowerCase() === ADMIN_NAME) {
    if (text === '/maint') { startMaintenance(); return; }
    if (text.startsWith('/call')) {
      const arg = (text.split(' ')[1] || '').toLowerCase();
      const alias = { gorehorn: 'direking', direking: 'direking', solaris: 'solaris', necrolord: 'necrolord', inferno: 'inferno', seraphim: 'seraphim', chronos: 'chronos', celestial: 'celestial' };
      const ty = alias[arg];
      if (!ty) { sysMsg(p, 'Usage: /call gorehorn | solaris | necrolord | inferno | seraphim | chronos'); return; }
      const m = Object.values(monsters).find(mm => mm.type === ty);
      if (!m) { sysMsg(p, 'That MVP does not exist yet.'); return; }
      const t = MONSTER_TYPES[ty];
      m.dead = false; m.hp = t.hp; m.x = p.x + 100; m.y = p.y;
      m.homeX = m.x; m.homeY = m.y; m.target = null; m.enraged = false; m.slowUntil = 0;
      broadcast({ t: 'event', kind: 'boss', text: '📢 GM 007 HAS SUMMONED ' + t.name.toUpperCase() + '!! RUN OR FIGHT!!' });
      return;
    }
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
  m.respawnAt = Date.now() + (t.superMvp ? 1800000 : t.mvp ? 1200000 : t.boss ? 600000 : 8000 + Math.random() * 7000);
  let zmult = 1;
  if (killer.cls === 'merchant') zmult *= 1.3;
  if (Date.now() < killer.zenyBuffUntil) zmult *= 2;
  zmult *= 1 + cardEff(killer, 'a', 'zeny');   // HERO CARD Merchant
  killer.zeny += Math.round((t.zeny + Math.floor(Math.random() * t.zeny * 0.5)) * zmult);
  broadcast({ t: 'event', kind: 'mdeath', id: m.id, x: m.x, y: m.y, killer: killer.id, zeny: t.zeny });
  if (t.boss) broadcast({ t: 'event', kind: 'boss', text: killer.name + ' has slain ' + t.name + '! It will return in 10 minutes...' });
  // party XP share: members within 500px each gain 40% bonus XP
  if (killer.party) {
    for (const pid in players) {
      const v = players[pid];
      if (v.id !== killer.id && !v.dead && sameParty(v, killer) && Math.hypot(v.x - m.x, v.y - m.y) <= 500) grantXp(v, Math.round(t.xp * 0.4));
    }
  }
  // rare equipment drop - Legendary ONLY from MVP; MULTIVERSE ONLY from HELL & HEAVEN gods
  const dropCh = m.type === 'celestial' ? 0.8 : t.superMvp ? 0.5 : t.mvp ? 0.25 : t.boss ? 0.08 : 0.005;
  if (Math.random() < dropCh && killer.eq.inv.length < INV_MAX) {
    const kind = ['w', 'a', 's', 'x', 'h', 'b'][Math.floor(Math.random() * 6)];
    let tier;
    if (t.lvl >= 40) tier = Math.random() < 0.5 ? 5 : 4;
    else if (t.lvl >= 16) tier = Math.random() < 0.5 ? 4 : 3;
    else if (t.lvl >= 6) tier = Math.random() < 0.6 ? 3 : 2;
    else tier = Math.random() < 0.6 ? 2 : 1;
    let rarity;
    if (m.type === 'celestial') { tier = 5; rarity = Math.random() < 0.8 ? 4 : 3; }        // God of Gods: 80% MULTIVERSE
    else if (t.superMvp) { tier = 5; rarity = Math.random() < 0.6 ? 4 : 3; }               // gods: 60% MULTIVERSE
    else if (t.mvp) { const r = Math.random(); rarity = r < 0.4 ? 3 : r < 0.8 ? 2 : 1; }   // MVP: 40% Legendary
    else { const r = Math.random(); rarity = r < 0.7 ? 0 : r < 0.95 ? 1 : 2; }             // others: max Epic
    const it = newItem(kind, tier, rarity);
    killer.eq.inv.push(it);
    broadcast({ t: 'event', kind: 'lootdrop', id: killer.id, item: itemName(it), tier: rarity >= 2 ? 4 : tier, x: Math.round(m.x), y: Math.round(m.y) });
    if (rarity >= 2 || tier >= 4) broadcast({ t: 'event', kind: 'boss', text: '✨ ' + killer.name + ' looted ' + itemName(it) + '!' });
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
    if (tgt && inHome(tgt)) { tgt = null; m.target = null; }   // lose interest when player reaches home
    if (!tgt && t.aggro > 0) {
      for (const pid in players) {
        const p = players[pid];
        if (p.dead || inHome(p)) continue;
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
        } else if (m.type === 'zombie' && d < 90) {
          fxMsg.x = Math.round(tgt.x); fxMsg.y = Math.round(tgt.y); broadcast(fxMsg);
          const dd = Math.floor(t.atk * 1.2);
          m.hp = Math.min(t.hp, m.hp + Math.floor(dd / 2));
          if (monsterHitsPlayer(m, tgt, dd)) killPlayer(tgt, m);
        } else if (m.type === 'plague') {
          broadcast(fxMsg);
          for (const pid in players) { const pl = players[pid]; if (!pl.dead && Math.hypot(pl.x - m.x, pl.y - m.y) < 105) { if (monsterHitsPlayer(m, pl, Math.floor(t.atk * 0.85))) killPlayer(pl, m); } }
        } else if (m.type === 'demon' && d < 170) {
          fxMsg.x = Math.round(tgt.x); fxMsg.y = Math.round(tgt.y); broadcast(fxMsg);
          if (monsterHitsPlayer(m, tgt, Math.floor(t.atk * 1.3))) killPlayer(tgt, m);
        } else if (m.type === 'cherub' && d < 180) {
          fxMsg.x = Math.round(tgt.x); fxMsg.y = Math.round(tgt.y); broadcast(fxMsg);
          m.hp = Math.min(t.hp, m.hp + 300);
          if (monsterHitsPlayer(m, tgt, Math.floor(t.atk * 1.2))) killPlayer(tgt, m);
        }
      }
      // ---- boss enrage + SOLARIS MVP rotation ----
      if (t.enrageAt && !m.enraged && m.hp < t.hp * t.enrageAt) {
        m.enraged = true;
        broadcast({ t: 'event', kind: 'boss', text: '🔥 ' + t.name + ' ENRAGES!!' });
        broadcast({ t: 'event', kind: 'skillfx', id: m.id, skill: 'warcry', x: Math.round(m.x), y: Math.round(m.y) });
      }
      if (t.mvp) {
        const rage = m.enraged ? 1.5 : 1;
        if (now > (m.flareAt || 0)) {
          m.flareAt = now + (m.enraged ? 6000 : 8000);
          broadcast({ t: 'event', kind: 'skillfx', id: m.id, skill: 'inferno', x: Math.round(m.x), y: Math.round(m.y) });
          const flareDmg = t.aoeDmg || Math.floor(t.atk * 2 * rage);
          for (const pid in players) { const pl = players[pid]; if (!pl.dead && Math.hypot(pl.x - m.x, pl.y - m.y) < 130) { if (monsterHitsPlayer(m, pl, flareDmg)) killPlayer(pl, m); } }
        }
        if (now > (m.beamAt || 0) && d < 260) {
          m.beamAt = now + (m.enraged ? 4000 : 5000);
          broadcast({ t: 'event', kind: 'skillfx', id: m.id, skill: 'jupitel', x: Math.round(tgt.x), y: Math.round(tgt.y) });
          if (monsterHitsPlayer(m, tgt, Math.floor(t.atk * 2.5 * rage))) killPlayer(tgt, m);
        }
        if (!m.enraged && now > (m.healAt || 0)) {
          m.healAt = now + 10000;
          if (m.hp < t.hp) {
            m.hp = Math.min(t.hp, m.hp + Math.max(400, Math.floor(t.hp * 0.015)));
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
  const hh = equippedItem(p, 'h');
  const awakened = EQUIP_SLOTS.some(sl => { const it = equippedItem(p, sl); return it && it.r === 4 && it.p >= 15; });
  return {
    id: p.id, n: p.name, c: p.cls, x: Math.round(p.x), y: Math.round(p.y),
    d: p.dir, mv: p.moving, hp: p.hp, mh: p.maxHp, lv: p.level,
    xp: p.xp, xn: xpNeeded(p.level), z: p.zeny, dead: p.dead, b: isBuffed(p) ? 1 : 0,
    eq: [w ? w.t : 0, w ? w.p : 0, a ? a.t : 0, a ? a.p : 0], po: [p.eq.red, p.eq.white],
    wc: w ? w.c : null, ac: a ? a.c : null, cd: p.eq.cards, adv: p.adv || 0,
    spm: 1 + cardEff(p, 'a', 'spd') + (p.spdBonus || 0), au: cardEff(p, 'a', 'aura') > 0 ? 1 : 0,
    hx: p.home ? p.home.x : 0, hy: p.home ? p.home.y : 0, pk: p.pk || 0, sf: inHome(p) ? 1 : 0,
    pt: p.party || '',
    hd: hh ? [hh.t, hh.r || 0] : [0, 0], mvw: awakened ? 1 : 0
  };
}

server.listen(PORT, () => {
  console.log('=========================================');
  console.log('  007 ONLINE - server started');
  console.log(`  Local play:  http://localhost:${PORT}`);
  console.log('=========================================');
});
