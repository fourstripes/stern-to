# Simulation review · 23 November 2026

## Outcome and scope

This pass reviews vessel handling, contacts, mooring, mission progression, traffic, navigation marks, water rendering and mobile work budgets. It retains the static WebGL 2 architecture and pinned local Three.js r187 bundle. There are no new runtime packages, external services or build requirements for the deployed game.

The implementation favours predictable, readable handling: momentum remains after neutral, hulls respond differently, deliberate inputs work at docking speed, and traffic makes early avoiding decisions. The figures below are measured responses of the game model, not sea-trial measurements of specific yachts.

## Vessel dynamics and contacts

The planar equations now include all three added-mass Coriolis terms. Their combined kinetic power is zero. The old yaw equation omitted the surge/sway coupling, which changed turning behaviour and broke that property. The pure `physics.js` module makes the force and contact calculations independently testable. The mathematical basis is [Fossen's marine-craft model](https://www.fossen.biz/html/marineCraftModel.html).

Rudder force now uses the local flow at the stern, including stern movement during a turn, and includes the corresponding axial drag. A coasting, unpowered rudder cannot add energy. The tender has increased stern-flow damping and reduced full-lock authority at speed. Testing the corrected model exposed an uncommanded tender spiral after a small sideways disturbance; the final calibration returns to straight running with the helm centred.

Contacts use directional added mass and the velocity remaining after the normal impulse when applying friction. Fender restitution is 0.05 and bare contact restitution is 0.15. The old protected value was 0.50, making fenders bounce more than an unprotected hull. Damage, fender compression and burst feedback remain, with hard-contact splash sent through the functioning spray system.

The dominant swell uses the same direction, frequency and phase as the shared water model. Force follows the down-slope phase, and sheltered water also reduces wave yaw and roll. Opposing beam seas now produce opposing roll, and the wind-heel sign matches the lateral force.

### Calibrated responses

Measurements use the actual fixed-step production functions in calm water unless stated otherwise.

| Measurement | Tender | Superyacht | Megayacht |
| --- | ---: | ---: | ---: |
| Full-ahead cruise | 26.99 kn | 15.35 kn | 16.16 kn |
| Full-astern stop from cruise | 47.73 m | 53.03 m | 82.11 m |
| Stop time, including drivetrain delay | 6.82 s | 14.07 s | 21.53 s |
| Steady full-lock turn diameter | 63.25 m | 105.19 m | 165.10 m |
| Peak yaw during the turn | 21.52°/s | 6.94°/s | 4.67°/s |
| Displacement in 15 kn crosswind after 30 s | 9.03 m | 5.77 m | 4.77 m |

Cruise speed is preserved. Before this pass the tender's full-lock turn diameter was about 17.6 m with a peak yaw rate around 55.9°/s. The new result leaves it manoeuvrable while substantially reducing the high-speed spin.

## Mooring and the final anchorage

Bring in is an automatic 0.8 m/s retrieval command for the selected anchors. Stop pauses it, and the dedicated −/+ chain controls take over. An anchor cannot disappear aboard while still far from the hawse. Input ownership is cleared when its target disappears, preserving independent line, engine and thruster controls.

Shore service now requires two actual shore lines. Two anchors alone cannot satisfy fuel or shipyard service. Crew movement, anchor deployment and fender protection advance on the fixed simulation clock, with matching results at 30, 60 and 120 Hz display rates.

The final anchorage previously depended on a hidden horizontal chain-stretch condition. Its visible goal is now:

1. The anchor lies inside the marked circle.
2. At least 13 m, 18 m or 27 m of chain is out for the tender, superyacht or megayacht respectively.
3. The chain is held automatically after adjustment, with retrieval stopped.
4. The vessel settles without dragging for three continuous seconds.

The selected-chain readout shows actual chain to one decimal place without rounding a short length up to the target. The final goal, target and progress now sit inside the same Anchors panel, preventing the previous collision when that panel was moved to the top-left corner. A secure second anchor can satisfy the goal even if the other anchor is dragging. Interrupted settling resets progress.

The compact anchor controls use Port/Starboard points on a yacht diagram, Both, Drop, Bring in/Stop and −/+. A drop starts with 3 m of automatically held chain. Each tap adjusts one metre; a sustained hold continues adjustment. The tender has a single centred Bow point. Line actions remain in Lines, and changing the selected anchor does not change which anchor can qualify for the mission.

The mooring controls use a single equipment toolbar with one compact card at a time. The 24 November refinement restores the small yacht diagram for Lines and uses matching diagrams for Anchors and Fenders. Six labelled line points preserve the spatial reference without the earlier tall silhouette. Anchor selection is separate from dropping or retrieval. Fender sides toggle individually, with Both and Stow commands and actual intact-fender counts during crew work. Short landscape screens place the equipment card beside the helm rather than stacking their heights. The panel has no internal scroll area. Line labels remain visible when status or selection changes.

The previously detached anchor chain used a different origin from the hull pocket and stowed anchor. A shared socket on the scaled pocket surface now meets the anchor's actual shackle, including through heel, pitch, dropping and retrieval. The existing 220-link instanced pool is retained; each side receives a budget and draws from the hull downward, so a capacity limit cannot detach the visible chain from the hull. Geometry tests cover all three vessels and buffer reuse without changing physical anchor forces.

Success starts a 4.5-second camera pan and zoom, then displays the mission result. Controls are temporarily held during the reveal, and Keep playing restores the prior camera. Reduced-motion preference skips the automatic camera movement.

## Navigation and traffic

The original mission arrow aimed directly across the island. Guidance now uses a small visibility graph over authored clear-water junctions, with clearance checks against land, quays and moored boats. Paths and advice are cached outside rendering. Departure completion still checks the final exit, so reaching an intermediate waypoint cannot prematurely finish a leg.

Traffic predicts relative motion and closest approach. Head-on, crossing, overtaking and stationary hazards receive different responses. Decisions run at 5 Hz, movement runs at 60 Hz, and a swept-hull check protects every movement. Candidate paths include braking and stern movement during turns. Both moving boats plan from the same world snapshot. Static bounds and a clear-course fast path avoid unnecessary candidate searches.

An independent review caught a route-bend error: a port-side waypoint could override a head-on starboard duty. Turn responsibility is now evaluated against the vessel's actual heading, with explicit starboard candidates and regression tests for port-bending routes. Obstructed starboard water can still require another collision-avoiding action.

The game's 6 kn harbour advisory applies only within designated harbour zones. It is a game rule, not a claim that one speed limit applies to real harbours. The navigation guide is grounded in the [IMO COLREG summary](https://www.imo.org/en/ourwork/safety/pages/preventing-collisions.aspx) and [Transport WA's marker guide](https://www.transport.wa.gov.au/getmedia/e13d521a-03c7-4d7c-ac4d-cb90594a2f69/MAC_P_MarkersBuoysBeacons.pdf). East-cardinal cones now point outward, matching their black-yellow-black body and east-side passage meaning.

Both authored moving-boat routes completed at every hull/world scale with no static hull overlap in deterministic runs. Tests also cover paired boats, crossing responsibility, overtaking, a blocked starboard side, stopping before a quay, and recovery when an obstruction clears.

## Water graphics and performance

The shared six-wave Gerstner model now drives geometric displacement, analytic normals, buoy motion and CPU height queries. CPU queries invert horizontal displacement, rather than sampling a sine wave at the wrong surface coordinate. Wavelength and frequency follow deep-water dispersion, and steepness is bounded to prevent the surface folding. The shelter gradient and the scripted large wave are treated consistently. The derivation follows the analytic approach described in [NVIDIA's effective water simulation reference](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models).

Live bow spray, wind-blown mist, prop wash and splash remain. Spray meets the moving water surface and larger droplets leave foam. Highlights use the corrected normal basis; restrained wind-driven crest froth uses surface compression already calculated by the shader. Ripple detail is filtered against the pixel footprint, reducing shimmer and unnecessary distant work. Underway traffic no longer receives the visual surge offset intended for moored boats.

Heave, pitch and roll use an exact damped-spring step. Foam runs at a fixed 30 Hz, with time-based decay and resolution-correct diffusion. An empty foam field skips the offscreen pass. Unused particle textures, discarded spray work, obsolete queue state and 27 legacy CSS rules were removed.

| Budget | Desktop | Mobile | Mobile under load |
| --- | ---: | ---: | ---: |
| Sea triangles | 294,912 | 131,072 | 73,728 |
| Foam texture | 512 × 512 | 256 × 256 | 256 × 256 |
| Maximum micro-ripple octaves | 9 | 6 | 4 |
| Wake history samples | Every entry | Every entry | Every second entry |

The initial mobile sea mesh has 55.6% fewer triangles, and the foam texture has 75% fewer texels. Those are resource-budget reductions, not measured iPhone frame-rate gains. Quality reductions preserve active spray and first reduce secondary water detail.

Current research reviewed included the May 2026 [Dynamic Wave Trains paper](https://doi.org/10.1111/cgf.70495), which supports spatially varying procedural waves. This release does not claim to implement that research solver. A shared analytic model suits the existing mobile game; adding a full bathymetry, shallow-water or fluid-volume solver would require a different scene and validation scope.

## Shared play total

The menu counter already used one shared server-side key, `sternto-dock-sim/plays`, through [Abacus](https://v2.jasoncameron.dev/abacus/). It was not a per-device count. Its previous page-lifetime guard counted only the first game started during each visit, omitting further games in the same tab.

The label is now Total games played. Every successfully started game increments the same existing global counter, including restarts and retries. Loading the page, opening the menu, resuming and continuing voyage legs only display or refresh the total. No historical value is reset or estimated, and past omitted restarts cannot be reconstructed.

Reads refresh on menu opening with a cooldown and in-flight deduplication. The exact formatted number is shared across players; it counts games rather than unique people. Invalid or older responses cannot reduce the displayed total. Failed or ambiguous increment requests are not automatically retried, avoiding accidental double counts. The counter remains a lightweight online total: failed requests can miss a play, and a service outage must not prevent gameplay. No browser identifier, cookie or account is needed by this integration. Production-origin checks exclude local and preview testing.

A read-only production request returned the existing total with HTTP 200 and the required cross-origin response header for GitHub Pages. The initial 15-second timeout proved too short: a later successful request took 20.448 seconds, while the official alias also responded slowly. Requests now have a 30-second asynchronous budget, with one read-only retry after three seconds. The counter sits at the top of the menu with an explicit Retry control and a Last known label when a previously confirmed total cannot refresh. The existing endpoint and key are retained. Validation did not issue a live increment or reset.

## Verification and limits

- JavaScript syntax checks and the full Node test suite.
- Physics sign, energy, contact, steering stability and all-hull calibration tests.
- Traffic encounter tests and route checks at all three vessel scales.
- Final-anchor acceptance and rejection cases, visible goal precision, camera reveal and continued play.
- Wave inversion and derivatives checked against independent numerical differences.
- Heave, foam and gameplay timing checks across different display rates.
- Resource lifecycle checks, CSS parsing and unique DOM identifiers.
- Shared-counter tests using separate browser instances, new-game versus resume behaviour, stale replies and service failures, without incrementing the live counter.
- Actual sea, sky, foam-fade and foam-stamp shader bodies compiled and linked with Three.js r187 chunk expansion in an OpenGL ES 3.2 Mesa 25 software context, with no compiler or linker messages.
- Reproducible vendor bundle check and GitHub Actions release gates.

The shader check verifies executable shader structure. It does not establish the final appearance or frame rate on an iPhone. The numerical model is a calibrated game approximation with analytic waves, simplified line/anchor forces and local traffic prediction. There is no measured bathymetry, tide/current field, full hydrostatic solver or claim of training-grade COLREG compliance.
