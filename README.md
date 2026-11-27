# Stern-To

A browser docking simulator with a 12 m foiling tender, 50 m superyacht and 74 m megayacht. Practise three berths or sail the four-stop mission with wind, swell, traffic, mooring lines, fenders and anchors.

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

The core simulation runs at 60 Hz. Vessel dynamics, water sampling and navigation are small modules that can be checked without a browser. The three hulls have distinct calibrated handling; the existing harbours and four-stop mission remain. The twin screws turn outward, so a propeller going astern walks the stern sideways and adds to a split-engine twist. The yachts heel outward in a hard turn and trim slightly by the stern near hull speed; the tender is an arcade-tuned hydrofoil: on its hull, chop and the hump make it labour, then at about 16 kn it leaps onto its foils with a bounce. Its ride height grows with speed, and the higher it flies the less drag and chop hold it back, so it climbs to about 2 m and up to about 41 kn. Extra punch at high throttle gets it over the hump even in a gale, while docking throttle feels the same; throws itself into deeply banked turns that dip the inside, and leaves a long white sheet from its rear strut. It settles back onto its hull below about 14 kn or after a hard knock. At speed a curling white bow wave peels off each side of the stem, growing with speed, bigger on the side pushing into the water, leaping up when the bow buries into a sea and shedding wind-blown mist from its lip. Bow-wave foam spreads along the Kelvin angle, and the wake's crest spacing grows with speed.

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
| Choose anchors / drop or lock / bring in or stop | Z / X / B |
| Fenders | F |
| Top / chase camera | T / V |
| Pause / close equipment or open menu / restart | P / Escape / R |

Pointer and touch controls mirror these actions. Each engine slider and the rudder also support focused keyboard interaction. Momentary buttons accept held Enter or Space. The game pauses when its page becomes hidden; press Play when returning.

Anchors, Lines and Fenders share one skinny panel with three icons and start closed. Tap an icon to open its card, or tap it again to close; only one card opens at a time, and a green dot marks gear that is out. Each card shows the same small bow-up hull with plain circles: anchors at the bow, six lines around the hull (springs in the middle), and a fender on each side. Actions are symbols: down and up arrows drop and bring in the anchor, − and + adjust chain or heave and slack lines, and the hook arrow lets lines go. Names and states stay available to screen readers.

The equipment cards fit without an internal scroll area. On short landscape screens they use the space beside the helm, with the helm on the opposite side. A layout change releases momentary touches before controls move, while latched throttle stays set. Escape closes an open equipment card before opening the main menu.

The Anchors panel works like a real foredeck with three one-tap buttons. Tap the Port or Starboard anchor at the bow, or the pair for Both (the tender has one Bow anchor). The down arrow lets the anchor go, and the bosun then works the brake: enough chain to reach the bottom, then only as fast as the yacht moves away, so it never runs free. The down arrow pulses while chain is running. Tap the padlock to lock it off; it turns green when the chain is held. Tap the down arrow again to pay out more, or the up arrow to bring the anchor in (tap again to stop). The crew tell you when enough chain is out. The rendered chain and anchor shackle share the hull's anchor socket and remain connected through vessel movement, dropping and retrieval. The Lines panel has its own separate actions. All stop selects neutral; use astern thrust to brake the boat's momentum.

## Mission navigation and the final anchorage

Harbour detail: quays have a dark weed line and timber fenders, and a faint wash shows at the foot of a wall only when a wave crest reaches it. The town's buildings have windows that light up warm at night. Yachts show portholes at a real-world spacing, so bigger yachts show more, and moored yachts lie on bow and stern lines to the bollards. The anchorage island sits well off, with a low hill behind its palm beach. Each yacht is drawn with one mesh per material and the sea skips its wake-ring loop where no rings can reach, keeping frame rates steady. The amber arrow guides the boat around land to the next berth; only the final anchorage is marked on the water. Red and green lateral marks follow IALA region A: red to port and green to starboard on entry. East-cardinal cones point away from each other; safe passage is to their east. The game's harbour zones use a 6 kn advisory. Traffic predicts close approaches, slows or alters course when needed, and checks nearby hulls and quays before moving.

Shore service requires two actual fast shore lines. At the final anchorage, open Anchors to see the chain paid out, target and progress together:

| Tender | Superyacht | Megayacht |
| --- | --- | --- |
| 13 m | 18 m | 27 m |

Drop inside the marked circle, use + to reach at least the displayed target, release the control and settle for three seconds without dragging. The chain holds automatically. One secure anchor can complete the goal even when Both is selected. There is no hidden backing-distance condition. Completing the goal starts a short pan and zoom before the mission result. Keep playing restores the previous camera. Reduced-motion mode shows the result without the automatic camera move.

## Total games played

The Controls page shows one shared total across all players on the public GitHub Pages game. The existing server-side counter and its history are retained. Each successfully started game adds one, including a new Cast off, restart or retry. Page loads, menu visits, pause/resume and continuing a voyage do not add plays. This counts games, so one person can contribute more than one game.

The total sits at the top of the Controls page and refreshes when the menu opens, with a short cooldown and duplicate-read protection. Slow requests have up to 30 seconds to finish without blocking play. A failed read retries once; Retry and reconnection can request another read. Failed increments are never retried, because the service may already have counted them. Local development and preview URLs never contact the public counter. If the service cannot be reached, the menu shows an unavailable state or labels its last confirmed total as Last known; it does not invent a local total or silently reset the shared count.

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

## Licence

Stern-To is released under the [MIT Licence](LICENSE). The bundled Three.js engine keeps its own MIT licence in `vendor/THREE-LICENSE.txt`.
