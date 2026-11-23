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
| `src/runtime.js` | Fixed timestep, adaptive quality and drawing-buffer budgets |
| `vendor/three.module.min.js` | Local, pinned Three.js r187 bundle with the exports the game uses |
| `vendor/manifest.json` | Engine version, package integrity and bundle checksum |
| `tests/` | Timing, simulation, controls, startup and whole-game integration checks |
| `docs/review-2026-11-23.md` | Review decisions, verification and remaining visual release check |

Game code is organised by named sections and functions. The boat handling coefficients and existing challenges are preserved.

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
| Heave / slack / let go | Hold H / J, G |
| Anchor selection / action | Z / X |
| Fenders | F |
| Top / chase camera | T / V |
| Pause / menu / restart | P / Escape / R |

Pointer and touch controls mirror these actions. Each engine slider and the rudder also support focused keyboard interaction. Momentary buttons accept held Enter or Space. The game pauses when its page becomes hidden; press Play when returning.

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

The game engine loads from the same origin. Google Fonts is optional and falls back to system fonts. The existing public play counter runs only at `https://fourstripes.github.io/stern-to/` or its `index.html` URL, times out after six seconds and cannot block play. Local development and preview origins do not increment it.

Panel placement, mirroring mode and best scores use local storage. Storage failure is tolerated. Best scores still share the existing berth-based key across vessels and weather settings.
