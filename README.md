# Velo Rush — Mountain Grand Prix

An arcade 3D multiplayer cycling racer for the browser, built with **Three.js**, **Vite** and a **Node.js WebSocket** server.

Race up alpine hairpins, through a rock tunnel, over a gorge bridge past a waterfall, down a fast descent with jumps, through a gravel forest sector and along a lake back to a cobbled village finish. You can race AI riders offline, chase your own ghost in time trial, or race friends online with a room code.

## Maps

| Map | Setting | Racing character |
| --- | --- | --- |
| Mountain Grand Prix | Alpine valley, the original course | All-rounder: climbs, jumps, a gravel sector |
| Alpine Grand Tour | High Alps: stone villages, retaining walls, snow peaks | Long switchback climb, then the fastest descent (≈ 140 km/h) |
| Riviera Coast | Cliff road above the Mediterranean, lighthouse, olive groves | Flowing high-speed corners, a cape tunnel, a cove bridge |
| Black Forest Storm | Dense wet forest, cabins, a timber bridge (rain by default) | Narrow, technical, heavy braking |
| Grand Canyon Rim | Stepped sandstone strata, mesas, arches, a steel arch bridge | Long straights, drafting, momentum |
| City Night Criterium | Night downtown: lit towers, streetlights, crossings, an underpass | Technical urban corners and hard accelerations |

Each map is plain data in `shared/tracks.js` (control points, zones, checkpoints, environment parameters), so every client and the server build identical geometry from a short map ID. In multiplayer the host picks the map in the lobby, and the other players preload it while they wait.

## Quick start

Requires **Node.js 18+** (tested with Node 22).

```bash
# 1. install everything (client, server and shared packages via npm workspaces)
npm install

# 2. run the multiplayer server  → ws://localhost:8080
npm run dev:server

# 3. in a second terminal, run the client  → http://localhost:5173
npm run dev:client
```

To start both with one command, run `npm run dev`.

Single-player modes work without the server. You only need the server for **Multiplayer**.

### Production build (one process, one port)

```bash
npm run build     # builds client/dist
npm start         # serves the game AND the WebSocket server on http://localhost:8080
```

Set `PORT=9000 npm start` to change the port. To point a separately hosted client at another server, build with `VITE_SERVER_URL=wss://your-host npm run build`, or type the address into the *Server* field on the Multiplayer screen.

### Deploy to Cloudflare (Workers + Durable Objects)

The Worker serves the built game, and one Durable Object runs the same `GameServer` as the Node server. The game rules, anti-cheat and reconnection are identical, and the game page and the WebSocket share one URL.

```bash
npx wrangler login   # once: opens the browser to authorise your Cloudflare account
npm run deploy       # builds the client, then deploys → https://velo-rush.<your-subdomain>.workers.dev
npm run cf:dev       # optional: run the Worker locally on http://localhost:8787
```

The config lives in `wrangler.jsonc`. After a deploy, check the live server with `SERVER_URL=wss://velo-rush.<your-subdomain>.workers.dev node tools/net-test.mjs`, and read its logs with `npx wrangler tail`.

## Testing multiplayer locally

1. Start the server (`npm run dev:server`) and the client (`npm run dev:client`).
2. Open **two browser windows** at http://localhost:5173. For two separate player profiles, make the second one a private/incognito window or a different browser. Two normal windows share one saved profile, so give the second window a different name in the Multiplayer name field.
3. Window 1: **Multiplayer → Create Room**. Note the 5-letter room code (the **Copy** button copies it).
4. Window 2: **Multiplayer**, type the code, then **Join Room**.
5. Both players press **Ready**. The host presses **Start Race**. Bots fill the grid if the host set *Bots* above 0.
6. Things to try:
   - **Reconnection:** refresh a window mid-race. It rejoins the same race at its last server-validated position within 30 s.
   - **Late join:** join from a third window while a race is running. You spectate and are placed in the next race.
   - **Server restart:** stop the server with Ctrl+C. Clients get a *server restarting* notice, retry automatically, and return to the Multiplayer menu if the room is gone.

**Public races (no code needed):** in one window choose **Multiplayer → Quick Join** (or **Create public race**). In other windows press **Quick Join**, or click the race in the **Public races** list. Everyone lands in the same lobby. Once 2 or more riders are ready the race starts by itself: 3 s after everyone is ready, or 20 s after the second rider readies. Anyone not ready watches and joins the next race. `npm run test:public` checks the matchmaking rules on the server.

Other devices on your LAN can join at `http://<your-LAN-IP>:5173`. The client connects to port 8080 on the same host automatically.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Pedal / accelerate | W / ↑ | RT | PEDAL |
| Brake | S / ↓ | LT | BRAKE |
| Steer | A D / ← → | Left stick | ◀ ▶ |
| Sprint (hold, drains stamina) | Shift | A | SPRINT |
| Burst boost | Space | X | BOOST |
| Reset bike | R | Y | — |
| Camera distance | C | RB | — |
| Pause | Esc / P | Start | ❚❚ |
| Mute | M | — | — |

## Features

- **Power-based bike physics** (shared by client and server). There are no speed caps: speed comes from rider power ÷ speed, a low-gear torque band, drag ∝ v², rolling resistance and gravity. Typical speeds are about 64 km/h pedalling on the flat, 80–110 km/h sprinting, and 110–135 km/h on the mountain descent, where braking (about 0.6 g, weaker while leaned over) really matters before the corners. Sprint effort ramps in and fades as stamina drains, and pulling out of a long slipstream gives a slingshot. Riders lose speed uphill, gain it downhill, and slow down under aero drag and rolling resistance that depends on the surface (asphalt, cobbles, gravel, grass). Maximum cornering speed is limited by grip. The bike leans with lateral acceleration and flies off ramps and crests. Riders slipstream each other and bump lightly into one another and the barriers. A stamina system covers sprinting and burst boosts, and boost pads give extra speed.
- **AI riders** in four skill tiers. They brake for hairpins based on the curvature ahead, follow a racing line, overtake on the side with more room, tuck in to draft, and attack with sprints late in the race. They drive with the same inputs and physics as a human player.
- **Race rules:** a 3-2-1-GO countdown, 6 checkpoints per lap, laps, a finish line, positions, a podium, split and lap times, XP and levels, and personal bests.
- **Modes:** Quick Race, AI Race, Time Trial (with a recorded ghost and a live delta), and Multiplayer.
- **World:** a procedural mountain heightfield shaped around the track and a large backdrop of mountains. There are thousands of pines, broadleaf trees, rocks and grass, all instanced and chunked with distance LOD and wind sway. The course also has a cobbled alpine village with a church, crowds that cheer as riders pass, sponsor boards and bunting. It includes a tunnel with lamps, a stone bridge over a gorge with a river and a waterfall, a lake with boats, guardrails, chevron signs, hay bales, gantries (start, King of the Mountain, flamme rouge), inflatable checkpoint arches, clouds and birds.
- **Weather** (Clear, Cloudy, Fog, Rain or Random), chosen in Play or by the host in the lobby. It changes fog, sky, light and clouds. Rain adds a wet, reflective road, rain streaks, tyre spray, thunder and less grip (applied to bots and players alike).
- **Rendering** (Low, Medium, High, Ultra): ACES tone mapping, soft shadows that follow the player, and PBR reflections taken from the sky. On High quality there is GTAO ambient occlusion and bloom, plus a speed pass (radial blur, vignette and chromatic fringe) and particles for dust, sparks, confetti and waterfall mist. The FOV widens with speed, the camera shakes, and there are speed lines and a slipstream effect. Exposure adapts inside the tunnel.
- **Rider model:** a procedural cyclist and road bike. The legs use 2-bone IK on the rotating pedals and the arms follow the steering bars. The rider leans into corners, stands up to sprint with the bike rocking underneath, shifts back when braking, crouches over jumps and tucks on descents. Spoked wheels switch to motion blur at speed. There are 4 bikes with different stats, 12 colours and 5 jersey designs.
- **Audio** is fully synthesized with WebAudio: wind that rises with speed, tyre noise for each surface, gravel crunch, cobble rattle, chain whir, freewheel ticks, pedal strokes and brake squeal. There are also crowd, waterfall, birds and a tunnel echo, a spoken countdown (via speechSynthesis), jingles, and procedural music for the menu, the race and the final lap.
- **UI:** main menu with a live 3D attract mode, Play, Multiplayer (create/join, room code, player list, ready), Garage with a 3D turntable, and Settings for quality, effects, camera, volumes, steering assist and touch controls. The HUD shows position, standings with gaps, timer, lap and checkpoint, a speedometer, stamina and sprint meters, distance and gradient, and a minimap. There are also pause and results screens (podium, XP bar, rematch). The layout is responsive and has touch controls on phones.

## Project structure

```
/client                 Vite + Three.js browser game
  index.html            screens / HUD markup
  src/main.js           entry point
  src/core/             App (game loop, modes, menus, pause), Storage (profile, settings)
  src/render/           Renderer (quality presets, post-processing chain)
  src/world/            World, Terrain, Road, Props, Vegetation, Sky, Weather, procedural textures
  src/world/themes.js   per-map look: terrain palette/relief, vegetation mix, architecture, lighting, ambience
  src/world/builders/   reusable environment builders (roadside works, coast, canyon, city)
  src/entities/         CyclistModel (procedural bike + rider, IK), RiderView (state → model)
  src/camera/           ChaseCamera (chase, start orbit, finish orbit, menu flyover)
  src/input/            keyboard, gamepad and touch
  src/race/             SessionBase, LocalSession (offline + ghost), NetSession (online)
  src/net/              NetClient (WebSocket, clock sync, reconnection)
  src/audio/            AudioEngine (synth SFX and ambience), Music (sequencer)
  src/fx/               particles and speed lines
  src/ui/               UI controller, minimap, garage preview, CSS
/server                 multiplayer server
  GameServer.js         platform-neutral core: clients, sessions, reconnection, rooms, simulation tick
  index.js              Node host: HTTP (static client build + /health), WebSocket, heartbeat, shutdown
  Room.js               lobby → countdown → racing → results, validation, bots, results
/worker                 Cloudflare host: Worker serves client/dist, one Durable Object runs GameServer
/shared                 code used by BOTH client and server
  track.js              spline builder + Mountain GP definition (track-space coordinates, zones, pads, ramps, checkpoints)
  tracks.js             map registry: the five other maps + getTrack(id)
  physics.js            bike physics, drafting, collisions
  ai.js                 AI rider brain
  race.js               race rules: grid, countdown, checkpoints, laps, finish order
  protocol.js           message types + compact state packing
  constants.js, math.js
/assets                 notes on the procedural assets (no binary files needed)
/tools                  headless tests and dev tools
```

**How it fits together.** Riders live in *track space*: `s` is the distance along the centre line and `d` is the lateral offset. The physics integrates heading, speed and height in that frame. Riders stay attached to the road, progress is exact, and shortcuts are impossible by construction. Rendering maps `(s, d)` to world space.

## Multiplayer architecture

- **Server-authoritative race state.** The server owns the race clock (a shared GO timestamp), grid, checkpoints, laps, finish order, finish times, bots and results. Clients never report their own lap, place or time.
- **Client prediction for your own rider.** Each client simulates its own bike locally, so controls respond instantly, and streams compact state 20 times a second. For each update the server checks:
  - speed against a **physics envelope**: the fastest this rider could legally be going, integrated from slope, drag, and the stamina the server tracks from sprint and boost claims (boost pads are detected by position);
  - distance travelled against the reported speed;
  - lateral limits and height.

  Implausible updates are rejected, and the client gets a correction back.
- **Interpolation for everyone else.** Snapshots are sent 20 times a second. Remote riders are rendered 120 ms in the past, interpolated between snapshots, and briefly extrapolated if packets are late. A ping/pong exchange syncs the client and server clocks.
- **Bots** are simulated on the server with the same shared physics and AI.
- **Resilience:**
  - Session tokens allow reconnection within 30 s, resuming at the server-held position.
  - Late joiners spectate.
  - The host role migrates if the host leaves.
  - Dead sockets are dropped by heartbeat.
  - Empty rooms are closed.
  - Message flooding is rate-limited.
- **Public lobbies and Quick Join.** Rooms are private (joined by code) or public (listed in a global pool). The server makes every decision:
  - A public room is listed and matchable only while it is in the lobby, has a free seat and its host is connected. A race in progress, a full room or a closed room never receives strangers.
  - **Quick Join** picks the lobby with the most riders (then the oldest, then the player's preferred map). If none fits, it opens a new public lobby with that player as host.
  - Joining from the list is re-checked on the server; a lobby that filled up or started meanwhile falls back to Quick Join.
  - Messages are handled one at a time, so capacity checks are atomic: two players can't both take the last seat.
  - The list is pushed over the WebSocket only to players on the Multiplayer screen, only when it changes, at most twice a second. There is no polling.
  - So an idle host can't block strangers, a public lobby starts by itself once 2+ riders are ready (riders who aren't ready spectate and join the next race). Host authority, host migration, results and rematch are the same as private rooms.
  - On shutdown the server tells clients and closes cleanly.

## Speed reference

`npm run test:speed` prints the physics numbers. At the time of writing:

| Situation | Speed |
| --- | --- |
| Flat, pedalling (W) | ≈ 64 km/h (0 → 60 in ≈ 8 s) |
| Flat, SHIFT sprint | 60 → 80 in ≈ 3 s, ≈ 100 within one stamina bar, levels off ≈ 112 |
| Uphill 6% / 9% | ≈ 57 / 48 km/h |
| Downhill 8% / 12%, pedalling | ≈ 116 / 137 km/h |
| Mountain descent (in game) | 64 → 113+ km/h, braking into the corners |
| Braking 100 → 30 km/h | ≈ 53 m (brakes fade above ≈ 70 km/h) |

## Tests and tools

```bash
npm test              # headless 8-bot race: track, physics and AI sanity (≈2 s)
npm run test:net      # spawns the server and plays a real-time 1-lap race with 2 scripted clients:
                      # lobby rules, validation (teleport + impossible speed), reconnect/resume, results (≈3 min)
npm run test:speed    # equilibrium speeds, acceleration, braking distances, per-section lap profile
npm run test:validate # replays 16 simulated honest laps (with network jitter) through the server anti-cheat
npm run track:preview # prints track stats and writes track.svg
```

With the client running, `node tools/shot.mjs <dir> <menu|race|screens|ghost|mobile|check>` drives headless Chrome and saves screenshots. The `check` scenario verifies that terrain never covers the road. `node tools/mp-shot.mjs <dir>` plays a two-browser online race, and `node tools/perf.mjs` reports draw calls, triangles and FPS. These tools use your installed Chrome through `puppeteer-core`.

## Remaining improvements for production

- **Full server-side simulation of human riders from inputs**, with client reconciliation, instead of the current state validation plus physics envelope. That would make speed and position cheats impossible rather than bounded.
- **Accounts and persistence:** XP, levels and personal bests are stored in `localStorage`. They should move to a database behind authentication, with server-verified leaderboards.
- **Scaling:** rooms live in one Node process. Horizontal scaling needs sticky routing or a matchmaker, and a shared store such as Redis for sessions and room directories. Quick-match and a public room browser would also help.
- **Transport:** binary snapshots (for example ArrayBuffer or delta compression) instead of JSON; WebRTC/UDP-style unreliable channels for state; `wss://` behind TLS; origin checks and stricter rate limits.
- **Content:** more tracks (the track system is data-driven, so a new `points` list plus zones is enough to start one); weather and time of day; bike upgrades; real glTF rider and bike models with skeletal animation; recorded voice-over and music.
- **Performance:** merge each rider into fewer draw calls or use skinned instancing; impostors for distant trees; texture atlases and KTX2 compression; a WebGPU renderer path; adaptive resolution when FPS drops.
- **Quality assurance:** automated visual regression tests in CI, network condition simulation (latency, loss, jitter), soak tests with many rooms, and a range of mobile devices.
- **Accessibility and localisation:** remappable controls, colour-blind friendly UI, subtitles for audio cues, and translations.
