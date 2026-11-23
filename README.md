# Stern-To

A browser docking simulator with a 12 m tender, 50 m superyacht and 74 m megayacht. Practise three berths or sail the four-stop mission with wind, swell, traffic, mooring lines, fenders and anchors.

## Run the game

The committed files are ready for static hosting, including GitHub Pages. There is no build step for deployment.

For local play, serve the folder over HTTP:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/` in a current browser with WebGL 2 enabled. The ES modules require HTTP or HTTPS; opening `index.html` directly with `file://` is not supported.

## Project map

| File | Purpose |
| --- | --- |
| `index.html` | Page structure, controls, menus and startup status |
| `assets/game.css` | Desktop, touch and responsive presentation |
| `src/main.js` | Loading, first-frame readiness and graphics recovery messages |
| `src/game.js` | Vessel data, simulation, scene construction, controls and mission flow |
| `src/physics.js` | Vessel forces, added mass, rudder response and contact impulses |
| `src/navigation.js` | Traffic encounters, collision avoidance and clear-water guidance |
| `src/water.js` | Shared wave sampling, shader surface maths, motion and detail budgets |
| `src/runtime.js` | Fixed timestep, adaptive quality and drawing-buffer budgets |
| `vendor/three.module.min.js` | Local, pinned Three.js r187 bundle with the exports the game uses |
| `vendor/manifest.json` | Engine version, package integrity and bundle checksum |
| `tests/` | Timing, simulation, controls, startup and whole-game integration checks |
| `docs/review-2026-11-23.md` | Review decisions, verification and remaining visual release check |
| `docs/simulation-review-2026-11-23.md` | Physics calibration, water and traffic changes, anchorage rules and validation |

The core simulation runs at 60 Hz. Vessel dynamics, water sampling and navigation are small modules that can be checked without a browser. The three hulls have distinct calibrated handling; the existing harbours and four-stop mission remain.

## Controls

| Action | Keyboard |
| --- | --- |
| Port engine | W / S |
| Starboard engine | Up / Down |
| Synchronise engines | Q |
| Bow thruster | Hold A / D |
| Rudder / midships | Left / Right, C |
| Engines to neutral | Space |
| Mooring lines | 1–6 |
| Heave lines / slack lines / let lines go | Hold H / J, G |
| Choose anchors / drop / bring in or stop | Z / X / B |
| Fenders | F |
| Top / chase camera | T / V |
| Pause / close equipment or open menu / restart | P / Escape / R |

Pointer and touch controls mirror these actions. Each engine slider and the rudder also support focused keyboard interaction. Momentary buttons accept held Enter or Space. The game pauses when its page becomes hidden; press Play when returning.

Anchors, Lines and Fenders share one compact toolbar and start closed. Tap a button to open its card, or tap it again to close; only one card opens at a time. Each card uses a matching bow-up yacht diagram. Lines places six named controls around the yacht with separate state indicators and one action row. Closing a card leaves deployed equipment in place and stops its held hauling controls. Small toolbar status labels keep active equipment visible while closed. Tap either side of the Fenders diagram to rig or stow that side; Both and Stow operate both sides together. Side readouts show the actual intact fenders out while the crew works.

The equipment cards fit without an internal scroll area. On short landscape screens they use the space beside the helm, with the helm on the opposite side. A layout change releases momentary touches before controls move, while latched throttle stays set. Escape closes an open equipment card before opening the main menu.

The Anchors panel keeps its yacht diagram, Drop, Bring in and chain controls together. Tap the Port or Starboard anchor at the bow, or Both; the tender has one centred Bow anchor. Selecting a side does not drop or retrieve it. Amber outlines show selection and green state markers show deployed equipment. Drop lowers the selected missing anchors with 3 m of chain and holds automatically. Tap − or + for one metre, or hold to adjust continuously. Bring in retrieves the selected anchors over time and changes to Stop while retrieving. Both applies to both selected anchors; changing selection does not move or remove equipment. The rendered chain and anchor shackle share the hull's anchor socket and remain connected through vessel movement, dropping and retrieval. The Lines panel has its own separate actions. All stop selects neutral; use astern thrust to brake the boat's momentum.

## Mission navigation and the final anchorage

The amber waypoint guides the boat around land to the next berth. Red and green lateral marks follow IALA region A: red to port and green to starboard on entry. East-cardinal cones point away from each other; safe passage is to their east. The game's harbour zones use a 6 kn advisory. The Controls & rules menu explains head-on, crossing and overtaking encounters. Traffic predicts close approaches, slows or alters course when needed, and checks nearby hulls and quays before moving.

Shore service requires two actual fast shore lines. At the final anchorage, open Anchors to see the chain paid out, target and progress together:

| Tender | Superyacht | Megayacht |
| --- | --- | --- |
| 13 m | 18 m | 27 m |

Drop inside the marked circle, use + to reach at least the displayed target, release the control and settle for three seconds without dragging. The chain holds automatically. One secure anchor can complete the goal even when Both is selected. There is no hidden backing-distance condition. Completing the goal starts a short pan and zoom before the mission result. Keep playing restores the previous camera. Reduced-motion mode shows the result without the automatic camera move.

## Total games played

The menu shows one shared total across all players on the public GitHub Pages game. The existing server-side counter and its history are retained. Each successfully started game adds one, including a new Cast off, restart or retry. Page loads, menu visits, pause/resume and continuing a voyage do not add plays. This counts games, so one person can contribute more than one game.

The total sits at the top of the menu and refreshes when the menu opens, with a short cooldown and duplicate-read protection. Slow requests have up to 30 seconds to finish without blocking play. A failed read retries once; Retry and reconnection can request another read. Failed increments are never retried, because the service may already have counted them. Local development and preview URLs never contact the public counter. If the service cannot be reached, the menu shows an unavailable state or labels its last confirmed total as Last known; it does not invent a local total or silently reset the shared count.

## Development checks

Use Node.js 24.15 or later in the 24.x line, or Node.js 26+. Development dependencies do not load in the deployed game.

```sh
npm ci --ignore-scripts
npm run check
npm test
```

The integration harness executes the complete game with jsdom and the actual Three.js geometry, material and matrix classes. It replaces layout measurements, drawing, WebGL submission and the clock. It checks logic and resource ownership, but **does not compile GPU shaders, calculate CSS layout, measure device FPS or replace a browser play-test**.

GitHub Actions runs checks on pull requests and on `main`, and verifies that regenerating the engine produces the committed bundle.

## Update Three.js

Three.js and the bundler are pinned in `package.json` and `package-lock.json`. To make a deliberate dependency update, review the official migration guide, update the exact package version, then regenerate and test:

```sh
npm run vendor
npm run check
npm test
```

The vendor script selects the `T3.*` exports used in the game, preserves the MIT licence and writes an integrity manifest. Commit updated package files and `vendor/` together. Repeat a real WebGL 2 visual check before release. The same command is needed if new Three.js classes are added.

## External requests and saved preferences

The game engine loads from the same origin. Google Fonts is optional and falls back to system fonts. The shared public play counter runs only at `https://fourstripes.github.io/stern-to/` or its `index.html` URL, gives each request up to thirty seconds and cannot block play. Local development and preview origins do not increment it.

Panel placement, mirroring mode and best scores use local storage. Storage failure is tolerated. Best scores still share the existing berth-based key across vessels and weather settings.
