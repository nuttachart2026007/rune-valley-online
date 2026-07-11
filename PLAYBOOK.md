# RUNE VALLEY ONLINE — Owner's Playbook
*Pixel multiplayer RPG for you and your friends — inspired by Ragnarok Online (2002)*

---

## What you have

One folder = the whole game. Server + client + pixel art, all included.

| File | What it is |
|------|-----------|
| `server.js` | The game server (world, monsters, combat, chat) |
| `public/index.html` | The game your friends see in their browser |
| `package.json` | Tells the hosting service how to run it |
| `test_client.js` | Automated test bot (optional, for checking the server works) |

No database, no accounts, no installs for players — they just open a link and play.

---

## PART A — Try it on your own computer first (5 minutes)

**Step 1.** Install Node.js from https://nodejs.org (LTS version, big green button). Next-next-finish.

**Step 2.** Open Terminal (Mac: Cmd+Space, type "Terminal").

**Step 3.** Go to the game folder and start it:

```
cd path/to/rune-valley-online
npm install
npm start
```

You'll see: `RUNE VALLEY ONLINE - server started`.

**Step 4.** Open your browser → `http://localhost:3000` → enter a name, pick a class, ENTER WORLD.

Open a second browser tab and join again — you'll see two heroes in the same world. That's multiplayer working.

To stop the server: press `Ctrl+C` in Terminal.

---

## PART B — Put it online free so friends can join (15 minutes, one-time)

We'll use **Render.com** (free tier, no credit card needed).

**Step 1 — Put the game on GitHub** (Render pulls the code from there)
1. Create a free account at https://github.com
2. Click **+** (top right) → **New repository** → name it `rune-valley-online` → Create
3. On the repo page click **uploading an existing file** → drag in `server.js`, `package.json`, `test_client.js` and the `public` folder's `index.html` (create folder `public` by naming the file `public/index.html` during upload) → **Commit changes**

**Step 2 — Deploy on Render**
1. Create a free account at https://render.com (sign in with GitHub — easiest)
2. Click **New +** → **Web Service** → connect your `rune-valley-online` repo
3. Fill in:
   - **Name**: `rune-valley` (this becomes your game URL)
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Instance type**: **Free**
4. Click **Deploy Web Service** and wait ~2 minutes until it says **Live**

**Step 3 — Invite friends**
Your game is now at: `https://rune-valley.onrender.com` (your chosen name).
Send that link to friends. They open it, pick a name and class, and play with you. Done.

### Good to know (free tier)
- The server **sleeps after ~15 min with no players**. First person to open the link wakes it (takes ~40 seconds). Tell friends: "if it's loading, wait a minute."
- Free tier comfortably handles **10–20 friends** at once.
- Progress (levels/zeny) resets when the server sleeps or restarts. Fine for casual play sessions; persistent saves are the natural v2 upgrade.

---

## PART C — How to play (send this to friends)

- **Move**: WASD or arrow keys
- **Attack**: SPACE (hits the nearest monster in range)
- **Chat**: ENTER, type, ENTER again
- **Classes**: Swordsman = tanky melee · Archer = fast ranged · Mage = slow but hits hard
- **Monsters**: pink Jellies are harmless practice → Blue Jellies and Mushys fight back → **Dire Wolves (top-right of the map) will chase you. Bring friends.**
- Killing monsters gives **XP and zeny**. Level up = more HP and damage.
- If you die, you respawn in town after 3 seconds. No penalty. Go get revenge.

---

## PART D — Easy tweaks (no coding skill needed)

Open `server.js` in any text editor and change numbers, then redeploy (re-upload to GitHub — Render redeploys automatically).

| Want to... | Find this in server.js | Change |
|-----------|------------------------|--------|
| Make monsters weaker/stronger | `MONSTER_TYPES` block | `hp`, `atk` numbers |
| Faster leveling | `xpNeeded` function | lower `20` to `10` |
| More monsters | `SPAWN_ZONES` block | raise the count (2nd number) |
| Stronger classes | `CLASSES` block | `hp`, `atk` numbers |
| Redesign the map | `MAP_STR` block | edit the letters: `.` grass, `t` tree, `w` water, `p` path, `s` wall, `f` flower, `d` sand |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Friends see "Cannot reach server" | Server is waking up — wait 60 s and refresh |
| "port already in use" locally | Another copy is running — close old Terminal windows |
| Game feels laggy for one friend | It's their internet — the game is light, works even on hotel wifi |
| Want to restart the world | Render dashboard → Manual Deploy → Deploy latest commit |

---

## Roadmap ideas (v2 when you're ready)
Player saves (levels survive restarts) → more maps + portals → party system + shared XP → boss with loot drops → simple items/equipment → PvP arena.

*Built with the 6-step Signature Build Process — v1.0, July 2026*
