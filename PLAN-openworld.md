# Open-world driving: design and phased plan

This plan answers the request "give cars freedom to go outside road and can i go anywhere and
make other cars drivable too … implement whatever GTA has kind of … but on this theme". The
target is sandbox-style driving mechanics in the existing realistic sunrise art style.

Ground rules carried over from the brief and the request:

- No real brands, logos, UI or names taken from any game. The minimap, HUD and radio are
  designed in the scene's own quiet style (the loader and `#ride-prompt` typography).
- Grounded tone. No weapons and no violence. Pedestrians are never hit: the physics blocks
  it, and they react early (see 4.3). "Taking" a traffic car is framed as the driver
  getting out and letting you have it, not a carjacking.
- Everything stays generated in code at load time, apart from the existing GLB and Mixamo
  assets. Every new feature is off in `?shot=1` mode, so the critic frames stay comparable.
- Budget: about 7–8 ms of CPU per frame while driving on the RTX 4060 desktop. The low tier
  must still run on a phone.

**Freeze:** another builder is currently editing `src/world/cars-glb.js`, `crowd.js`,
`mixamo.js`, `people.js` and `src/vehicles/index.js`. Nothing in this plan should start in
those files until that round has landed and been merged. The tasks marked *(frozen file)* wait
for it. Everything else can be prepared before then: the pure-maths sim changes in
`src/vehicles/sim.js`, `layout.js`, `traffic-sim.js`, the new modules and the Node tests.

---

## 1. Where the hard limits live today

| Limit | Where | How it works |
|---|---|---|
| Convertible stays on the road | `src/vehicles/sim.js` `SPECS.car` | `maxGround: 0.1` makes `blockedAt()` return `'curb'` for any wheel on ground above 10 cm. Curbs are `CURB_HEIGHT` 0.15, so every sidewalk, the park and the curb-ramp tops stop it. `maxStep: 0.1` blocks any step up. `vmax.grass/sand/wetsand = 3` caps it even if it got there. |
| Convertible's west limit | `SPECS.car.x0At` | Bound to `bounds.x0` (the hotel patio line), or to x −52 down the cross streets. |
| ATV stays on the beach | `SPECS.atv.xMin: 12.9` | Used by `blockedAt()` as the west bound. |
| Seawall | `src/world/beach.js` `seawallAccess()` | A box collider per wall run `WALL = {x0: 11.7, x1: 12.4, top: 0.68}`, cut only at `ACCESS_Z` / `MORE_ACCESS_Z`, plus cheek walls. The access steps (`STEPS`, 0.33 / 0.5 / 0.7 m) are climbable only by the bike (`accessStep` in `blockedAt()`) and the walker. |
| Water | `blockedAt()` `'deep'` rule, `SPECS.*.maxDepth` | Bike 0.2 m, ATV 0.32 m, car 0.1 m. The walker has `MAX_WADE = 0.5` in `src/player/walker.js`. |
| District bounds (vehicles) | `blockedAt()` `'bounds'` | A hard rectangle from `world.bounds`, which is `walker.world.bounds` (`createVehicles()` in `src/vehicles/index.js`). |
| District bounds (walker) | `src/main.js` `walkWorld.bounds` | `{x0: HOTEL.patioX + 0.2 (−27.8), x1: 110, z0: −340, z1: 340, soft: 14}`. `Walker.blocked()` treats it as a wall. `Walker.update()` tapers speed over the last 14 m (`B.soft`). |
| Invisible walls, player | `Walker.blocked()` | The rectangle above, `STEP_UP` 0.46, `MAX_WADE`, and all colliders. The hotel footprints are boxes out to x −80 (`hotels.userData.footprints`). |
| Traffic confined to lanes | `src/world/traffic-sim.js` | 1D model: a car is `{z, dir}` with `x = LANE_X[dir]`. The loop re-enters at `END_Z = 460`. |
| Traffic drivers | `crowd.js` `attachDrivers()` → `traffic.attachDrivers(makeDriver)` | A skinned body parented to `rig.pelvis` (the `<kind>_driver_pelvis` empty). |
| Sun shadows | `src/sky.js` `placeShadow(z)` | The shadow box spans x −62…96 and ±80 m in z, and follows only the camera's **z**. Anything west of x −62 gets no sun shadow. |
| LOD / culling | `src/world/lod.js` `RADIUS`, `QUALITY.hotelFar` | Everything is keyed on camera **z** (`updateLod()` early-outs when z moved < 2 m). |

The world is visually larger than the walkable district already. Street asphalt runs to
`WORLD_Z = 2500`. The far hotel row (`hotels.js` `streetPlan()`, `detail: 0`) and far cross
streets (`CROSS_STREETS` with `far: true`, z ±410…±850) run to z ±960. The near cross streets
run west to `CROSS_WEST = −400` (`street.js`). There is a continuous back row of 2–6 storey
blocks at x −58…−92, and pastel frontage along each near cross street from x −94 to −300
(`placeholders.js`, one `InstancedMesh`). West of the sidewalk, `groundHeight()` is a flat
0.15 m (plus the cross-street crown). Opening the world is mostly about bounds, colliders,
shadows, LOD and traffic, not new art.

---

## 2. Letting vehicles leave the road

### 2.1 Terrain access

- **Curbs.** Remove `maxGround` from the car specs. Raise `maxStep` to 0.2 m for cars (0.3 m
  for the SUV, pickup and ATV). A step over 0.08 m costs speed (`lon *= 1 − 0.9·step`) and
  kicks the sprung body (`bodyV += step·k`, which already feeds `v.land` and the audio
  `thump`). Mounting a curb at 50 km/h should feel like a jolt, not a wall.
- **Cross-street limit.** Replace `x0At` and `xMin` with the world extent (section 3.3).
- **Seawall.** Keep it solid; it is a real wall. Add two **vehicle beach ramps**, which
  Miami Beach really has for lifeguard trucks, at z ≈ −95 and z ≈ +95. These spots are clear
  of the steps (`ACCESS_Z`), the towers (z 5, ±200) and the Ocean Drive crosswalk legs.
  - `layout.js`: a `RAMPS` list and a `rampHeight(x, z)` term in `groundHeight()`, grading
    from the park (0.15 m at x 8.5) to the sand crest (`sandHeight(12.8)` ≈ 0.55 m) over 4.5 m.
  - `beach.js` `seawallAccess()`: add each ramp to `cuts`, and add a ramp mesh with low
    cheek walls.
  - `sim.js`: `ACCESS_ZS` stays for the bike steps.
- **Water.** `maxDepth` becomes the per-body *hard* limit (the existing `'deep'` rule). A new
  `intake` depth triggers a stall before that (2.3).

### 2.2 The surface model (`src/vehicles/sim.js`)

`surfaceAt()` already returns `pavement | grass | sand | wetsand | water` with `soft` and
`depth`. Extend it so it also returns `curb` / sidewalk (x in the sidewalk bands),
`promenade` (the `promenadeX()` band, pavers) and `sidewalk-west` (everything west of the
hotel sidewalk).

Replace the per-vehicle `vmax[surface]` and `roll[surface]` tables with one shared
`SURF` table multiplied by a per-body `offroad` factor (0.55 sedan … 1.0 pickup / ATV):

| surface | lateral grip × | rolling drag (m/s²) | top speed × | bump amplitude (m) | notes |
|---|---|---|---|---|---|
| pavement | 1.0 | body base | 1.0 | 0 | |
| promenade (pavers) | 0.95 | +0.1 | 1.0 | 0.004 | a fine paver rumble in the audio |
| grass | 0.55 | +0.9 | 0.55 | 0.015 | spins up clumps (the spray `Points`, green-brown) |
| wet sand | 0.65 | +0.6 | 0.7 | 0.008 | packed and fast, as for the ATV today |
| dry sand | 0.4 | +2.5 | 0.35 → 0.7 with `offroad` | `sandDetail()` | sinking (below) |
| water | 0.3 | +(1 + 30·depth) | tapers with `waterK` | 0 | stall past `intake` |

- `vmaxFor()` and `rollFor()` read the table.
- `substep()` uses `grip × SURF.grip` for the lateral decay. The handbrake term stays.
- **Bumps.** `rideGround()` adds `surfaceNoise(kind, x, z)` for grass and pavers, a cheap
  sum of sines like `sandDetail()`. The wheel heights already drive pitch, roll and the
  body spring.
- **Sinking.** Add `v.sink[i]` per wheel. On soft sand it grows with
  `soft · (load + 2·wheelspin)` and recovers with rolling speed. It is capped per body at
  0.12 m for the sedan and 0.05 m for the pickup, SUV and ATV. The sink lowers `wheelH[i]`
  and adds `sink · 25` of rolling drag. When `sink > 0.8 · cap` and the car is slower than
  0.4 m/s, it is "bogged": the throttle only digs deeper, and rocking (reverse, then
  forward) or easing the throttle gets it out. That is fun and grounded, and the recovery
  key (4.5) is the safety valve.

### 2.3 Water depth and stalling

Add per body: `intake` (sedan 0.32, hatch 0.30, coupe 0.30, the hero 0.32, crossover 0.42,
wagon 0.34, SUV 0.50, pickup 0.55, ATV 0.40) and `maxDepth = intake + 0.2`.

- In `post()`, if `max(wheelDepth) + 0.15 > intake` for 0.4 s, the engine stalls:
  `engineOn = false`, the revs sag and the audio sputters. The existing starter logic in
  `vehicles/index.js` (`startT`) restarts it only once the depth is under `intake − 0.1`.
- The swash pushes a car in the surf: a small force along ±x from `surf.swashAt()`'s front
  motion, which gives a gentle drift.
- The spray emitter in `vehicles/index.js` already handles wheels in the water. It is
  currently disabled for `kind === 'car'`; enable it for cars.

### 2.4 Surface audio (`src/audio/vehicles.js`)

`updateBike()` already crossfades pavement, grass, sand and water layers. Give the car voice
(`makeCar` → a parametric `makeEngine`, section 4.6) the same set on top of its current
`roll`, `roar` and `scrub`:

- grass: a swish (a band-passed noise, 2–4 kHz, gated with speed) and clump ticks;
- sand: a low brown hiss and a granular crunch, rising with `soft`;
- wet sand: a slap;
- water: slosh per wheel depth (as the bike does) and a bow wave at speed;
- pavers: a fine rumble;
- curb mount: the existing `thump`.

All of it rides on the `audio.vehicle({ surface, soft, depth, bump })` state the sim already
sends.

---

## 3. "Go anywhere": how far the world can extend

### 3.1 Options

| Option | What it adds | Cost (4060 / high) | Cost (low tier / phone) |
|---|---|---|---|
| **A. Open the district edges** to z ±560 along Ocean Drive, and let the player go down the near cross streets to the back row (x −90). | Colliders for the far hotel row (verify that `hotels.userData.footprints` covers it), back-row colliders from the `placeholders.js` `bg` list, parked cars, and palms along the extension. | +2–5 draw calls, +0.2 MB colliders, +50–80k triangles in view | same extent; `hotelFar` is already 560 |
| **B. Ocean Drive to z ±960** (the whole far row, 5th to 15th) | Street furniture and palm far-LOD out there; sand is already `sandGeometry(…, 1 row)` beyond 345. | +8–12 draws, +10–15 MB geometry, +80–120k triangles | stop at ±560 |
| **C. Collins Ave** (N–S at x ≈ −100…−116, one block west) | Carve a corridor through the placeholder `bg` rows (the same zero-scale trick as `inRoad()`), an asphalt strip, sidewalks, curbs, lamps, a royal-palm row (far-LOD crowns), and colliders for the frontage. | +10–15 draws, +15–25 MB, +100–150k triangles; +0.5 MB colliders | ±450 only, crowns at 50 % (`farFoliage`), no palm shadows |
| **D. Washington Ave** (x ≈ −215…−229) | The same kit again, with a denser low-rise frontage. | +8–12 draws, +10–20 MB | leave out; the fog wall is at about that distance |
| **E. Collins traffic** | A second lane loop (generalise `LANE_X`, 5.2) | +10 traffic instances (pooled) | 4 cars |

Measured anchors from the README and the code: about 200 fps at 1024×576 on the 4060, a sun
shadow map of 4096–8192, and 30 traffic cars on high. The numbers above are estimates to
verify with `tools/perf-primary.mjs` and `_perf-district.mjs`. Expect the outer ring to cost
the most in the **shadow re-render** (5.1), not in drawing.

**Recommendation:** A in phase 1, B and C in phase 2, D and E in phase 3.

- On `high` and `medium`, build C across z ±450 (the 5th–15th cross-street grid).
- On `low`, stop at A plus C across z ±300 (walkable, fewer props).
- Allow +200–400 ms of build time for a new loader stage (`'Paving Collins Avenue…'`)
  in `main.js`.

### 3.2 Soft boundaries instead of walls

Use diegetic edges first and a soft fallback second. Never show a hard invisible wall at speed.

1. **Diegetic edges** (a new `src/world/edges.js`):
   - Ocean Drive and Collins end at "ROAD CLOSED" sawhorse barricades and a row of water-filled
     barriers, with a light-arrow trailer. The text is invented and plain.
   - The beach ends at a fenced dune-restoration zone to the north and a rock jetty to the
     south (South Pointe really has one).
   - West of the last avenue: a hedge and fence of a park, and construction hoarding across
     the cross streets.
   - These are knockable where that makes sense (the barricades, 4.7). The fence and jetty
     are solid.
2. **Soft taper.** A shared `edgeDistance(x, z)` drives:
   - the walker's existing `B.soft` taper;
   - for vehicles, a top-speed taper over the last 25 m and a gentle steering bias back
     toward the interior (an extra `steer` term in `readInput()`).
3. **Turn-back fade.** If a vehicle is still outside the extent after 3 s (a glitch, or
   pushed there), fade to the haze colour for 0.6 s and place it on the nearest road, facing
   the lane. This reuses the recovery path (4.5).
4. **The sea.** It already bounds itself: wade limits and the stall (2.3). The walker keeps
   `MAX_WADE`.

### 3.3 The world extent refactor (a new `src/world/extent.js`)

```js
export const EXTENT = { ... }                 // per tier: polygons / rectangles of drivable, walkable space
export function insideWorld(x, z, who)        // who: 'walker' | 'vehicle'
export function edgeDistance(x, z)            // metres to the nearest boundary (for tapers)
```

- `Walker.blocked()` / `update()`: replace the `b.x0 … b.z1` rectangle with `insideWorld` and
  `edgeDistance`. Keep the `bounds` object for the tests' stand-ins.
- `blockedAt()`: `'bounds'` comes from `insideWorld(cx, cz, 'vehicle')`. Delete `x0At` and
  `xMin`.
- `main.js` `walkWorld.bounds` and the walker's hotel-patio line: the patio edge becomes the
  hotel footprint colliders themselves (they are already boxes). The walker can then go down
  the cross streets.
- Keep `DISTRICT` for art density (palms, sand detail, crowd) and add `EXTENT` for movement.
  Don't conflate them.

### 3.4 Engine-side changes for a wider world

- `sky.js` `placeShadow(z)` becomes `placeShadow(x, z)`. The box also follows the camera's x
  when x < −40, still snapped to whole texels. The ±80 m span is fine.
- `lod.js` `updateLod()`: distance is `max(dz, dx)` for items registered with an x range.
  Add `registerLod(obj, z0, z1, kind, x0, x1)`.
- `cars-glb.js` `createProbe()` / `probe.follow()` clamps the probe z to `DISTRICT`. Clamp it
  to `EXTENT` instead *(frozen file)*.
- Traffic `END_Z` is fixed at 460. See 5.2.

---

## 4. Making any car drivable

### 4.1 Architecture

A new `src/vehicles/registry.js` owns every drivable body. `vehicles/index.js` keeps input,
camera, prompts and audio, and asks the registry for candidates.

```
entry = {
  kind: 'car' | 'bike' | 'atv',
  body: 'hero' | 'sedan' | 'hatch' | 'suv' | 'pickup' | 'coupe' | 'wagon' | 'crossover' | 'classic',
  v,                                        // sim.js vehicle state
  view,                                     // { apply(v), eye(out), eyeQuat(out), root, doors: [{side, local}], interior }
  origin: 'hero' | 'parked' | 'traffic' | 'player',
  slot,                                     // parked spot index / traffic slot, to hand back
  saved, lastSeen,
}
```

- **Materialising.** Parked and traffic cars are not sim bodies until the player is within
  reach (6 m). `registry.nearby(pos)` looks candidates up from the parked `fleet.cars` list
  and `traffic.sim.cars`, and promotes the one being entered: `createVehicle(specFor(body))`.
- **Sleeping.** Only the ridden vehicle and bodies settling or moving run `stepVehicle()`.
  The existing "other vehicles" loop in `update()` already only steps a body when it moves.
- **Cap.** Keep at most 6 player-touched cars live. Beyond that, return the oldest (not the
  saved car, and not in view) to its pool.
- **Specs.** Move `SPECS` out of `sim.js` into `src/vehicles/specs.js` (bike, atv, the hero
  `car`) and add the modern bodies (4.4). `sim.js` keeps `kind` checks only for bike and ATV
  behaviour (lean, CVT). All cars go through a generic `car` path with an N-speed automatic
  (`post()` currently hard-codes 3 gears; take `ratios.length`).
- **Collision circles** come from the body length and width: the same pattern as `SPECS.car`,
  a spine chain plus four corners, scaled by `L` and `W0` from `blender/modern.py` `K`.

### 4.2 Entering: E or F, at the driver's door

- `findNear()` in `vehicles/index.js` *(frozen file)* scores registry candidates by the
  distance to a **door point** rather than to the nearest circle:
  - Door points sit 0.45 m outside the body side at `doors[0]` from `K` in local z.
  - The driver's door is the left side (+x in glTF, the side the `modern.py` steering wheel
    sits on).
  - The passenger door also works, with a slide across (a 1.1 s transition instead of 0.6 s).
  - Prompt: `E enter` (the same `#ride-prompt` style). F is an alias for E.
- **Parked car:**
  1. Hide its `BatchedMesh` instances and its contact blob.
  2. Take a live instance from `trafficKit.makeModern(kind)` and set `paint.color` to the
     spot's colour.
  3. Disable the spot's static collider box (a `disabled` flag checked in
     `buildGrid().query` and in `Walker.blocked()`).
  4. Promote it to a sim body.

  This needs `buildFleet()` *(frozen file)* to keep kind, yaw and colour on each `cars[i]`
  entry, and a `taken` flag so its LOD `update()` hook doesn't re-show the instance.
- **Classics** (the pool in `buildCarsGlb`): these reuse the hero model and `poseHero()`, so
  they can use the same `drive` view as the hero with their own instance.
- **The hero** stays as is. It is just `origin: 'hero'`.
- Entry transition: the existing `trans` (camera lerp) plus a seat-down arc (dip 0.25 m,
  then rise), a door "clunk" and the seat creak. No door swing in phase 1: the GLB doors are
  not separate objects. Phase 3 splits them (4.5).

### 4.3 Traffic cars: the driver gets out

The tone is "borrowing": the driver steps out, gives a friendly wave or shrug, and walks
off. Never force, never a struggle.

- **Trigger:**
  - The traffic car must be stopped (`c.v < 0.3`), for example at a light, a crosswalk, or
    behind the player standing in the lane, which the sim already does
    (`reason: 'obstacle'`). The player is at the driver's door (the lane side), within 1.2 m.
  - A moving car is not enterable. It honks instead (5.2).
- **Handoff:**
  - `traffic-sim.js` gets `detach(id)`: the car leaves the lane list and its slot waits to
    re-enter from the loop end with a new model, as after `hidden`.
  - `traffic.js` gets `handOff(slot)`: it returns the render instance `I` (and `I.driver`)
    *without* `release()` pooling it, and `bind()` takes a fresh instance for the slot when
    it respawns.
  - The registry wraps `I` as a `traffic`-origin entry with a `specFor(I.kind)` sim body at
    the car's pose.
- **Driver exit** (a new `src/world/exit-driver.js`, using the crowd's person API after the
  frozen round):
  1. `exit` (0.9 s): detach the body from `rig.pelvis` into world space, keeping its world
     matrix. Tween the hips from the seat to a point 1.0 m outside the door along an arc,
     crossfading `drive_car` → `idle_standing`.
  2. `react` (1.2–1.8 s): `wave` or `idle_looking_around`, facing the player.
  3. `walk`: `walk_casual_*` to the nearest sidewalk point, then along it, using the
     crowd's steering against the static grid. Release when more than 60 m away and out of
     frustum.
  4. The driver's circle collider joins `dynamicCircles` while walking.

  There is no "getting out of a car" Mixamo clip in `clips.glb`. Its clips are `drive_car`,
  `drive_honk`, `wave`, walks, runs and idles. A Mixamo "Exiting Car" clip could be added
  through `tools/build-people.mjs` in phase 3. Until then the tween-plus-crossfade reads
  fine at 0.9 s. `crowd.js` must expose `makeDriver()`'s person (`d.P`) and a factory for
  "free walker" agents *(frozen file)*.
- **Player's body.** The hero seats the player's Mixamo body (`attachDriver`, head scaled
  0.001 for first person). For modern cars, reuse `makeDriver` with the player's
  character, seated on `<kind>_driver_pelvis` with `handsOnRim()` on `<kind>_grip_L/R`.

### 4.4 Handling per body type

Derived from `blender/modern.py` `K`: the wheelbase is `uF − uR`, and `R` and `track` come
from there too. The hero is `SPECS.car` today. Speeds are grounded: city and beach speeds,
with Shift as the "hard" pedal.

| body | wheelbase (m) | mass (kg) | top speed (km/h), road / Shift | 0–100 km/h (s) | steer lock / grip | clearance, offroad | intake (m) | character |
|---|---|---|---|---|---|---|---|---|
| hatch (compact) | 2.58 | 1150 | 150 / 165 | 10 | 0.58 / 9 | low, 0.55 | 0.30 | nimble, small turning circle, bogs in sand |
| sedan | 2.84 | 1450 | 170 / 185 | 9 | 0.52 / 8.5 | low, 0.6 | 0.32 | neutral, the benchmark |
| wagon | 2.90 | 1550 | 165 / 180 | 9.5 | 0.52 / 8.5 | low, 0.6 | 0.34 | a touch softer rear |
| coupe (60s classic) | 2.92 | 1500 | 175 / 195 | 8.5 | 0.48 / 7 | low, 0.5 | 0.30 | V8, loose tail, drifts easily |
| crossover | 2.72 | 1600 | 160 / 175 | 9.5 | 0.52 / 8 | mid, 0.8 | 0.42 | more roll, fine on wet sand |
| SUV | 2.82 | 2100 | 160 / 170 | 10.5 | 0.50 / 7.5 | high, 0.9 | 0.50 | heavy, body roll, good in sand |
| pickup | 3.32 | 2300 | 150 / 165 | 11 | 0.46 / 7 | high, 1.0 | 0.55 | big turning circle, bouncy empty bed, the best on the beach |
| hero convertible | 2.96 | 1750 | 70 → 120 / 135 | 12 | 0.46 / 6 | low, 0.5 | 0.32 | keep its soft wallow; lift the top-speed cap only |
| ATV | 1.25 | 300 | 45 / 55 | – | as now | 1.0 | 0.40 | now allowed off the beach via the ramps |

Mass enters only through the collision impulses (4.7) and the spring and roll constants
(`post()` `K`, `Kp`, `Kr` get a `mass` scale). Keep the kinematic bicycle model. The drift
change is in 5.4.

### 4.5 A generic cockpit for the modern GLBs

What `blender/modern.py` `interior()` has at LOD0: floor, belt-line door sill boxes, front
seats with headrests, a rear bench (not for the pickup), a dash slab under the windscreen,
and a steering-wheel **ring** at the driver's side. There are `<kind>_driver_pelvis` and
`<kind>_grip_L/R` empties. LOD1 is a single box.

What's missing for a first-person view:

1. **Steering wheel** merged into the trim mesh: it cannot turn. Split it into a
   `<kind>_steer` object with its pivot on the column axis, and add a hub and three spokes.
2. **No eye anchor.** Add `<kind>_eye` (pelvis + 0.62 m up, 0.05 m back). Runtime fallback:
   derive it from the pelvis empty.
3. **Roof from inside.** The body and greenhouse faces point outward, so from the seat the
   roof and pillars back-face cull and the sky shows through. Add a `headliner` inner shell
   in `modern.py` (the roof rings offset 3 cm inward, reversed normals, `interior`
   material). Runtime stop-gap: `side: DoubleSide` on the driven instance's paint and trim.
4. **Gauges:** a small binnacle box with `dialTexture('speedo')` (it exists in
   `cars-glb.js` and is brand-free) on a plane, with a needle object. Also add pedals and a
   rear-view mirror stalk. `rearMirror()` could be generalised later; it is costly (an extra
   render), so hero only in phase 1.
5. **Door cards:** a thin inner panel per door opening, so the door frames don't read as
   holes.
6. Phase 3: **front doors as hinged parts** (`<kind>_door_FL/FR` with pivots) for a visible
   swing on entry and exit.

Re-export through `blender/build_cars.py` → `tools/optimize-cars.mjs` (Meshopt) →
`public/models/parked.glb`. The triangle budget is +3–5k per body at LOD0, and LOD1 is
unchanged. Glass from inside: the modern cars use `M.tint` and `M.windshield`. Check the
inside view for over-dark tint and give the driven instance a `uInside`-style lighter
variant as the hero's screen does.

### 4.6 Engine audio per type (`src/audio/vehicles.js`, `src/audio/traffic.js`)

Generalise the hero's V8 (`makeCar`) into `makeEngine(profile)`. The firing frequency is
`rpm/60 · cyl/2`, with a harmonic mix, an exhaust low-pass, lope (a random firing-interval
jitter) and an intake band.

| profile | used by | cylinders | idle / redline (rpm) | colour |
|---|---|---|---|---|
| `i4` | hatch, sedan, wagon, crossover | 4 | 800 / 6500 | buzzy 2nd order, a light exhaust |
| `v6` | SUV | 6 | 700 / 6200 | smooth, a mid growl |
| `v8mod` | pickup | 8 | 650 / 5800 | a deep, even rumble, no lope |
| `v8classic` | coupe, classics, hero | 8 | 620 / 4400 | the existing hero voice with lope |

Add a gearbox with 5–6 speeds for the modern cars (the shift dip exists), tyre layers from
2.4, a push-button starter for the modern cars (0.4 s whirr), the player's horn (a two-tone
per profile), and door, seat and belt sounds. Traffic voices (`makeVoice`) take the same
profile parameters at their reduced cost.

### 4.7 Exiting anywhere

`dismountSpots()` gets door points per body (left door first, then right, then the ends). It
refuses when both doors are blocked and the ends too (the existing "No room to get out here"
message), or when the water at the door is deeper than the walker's `MAX_WADE`. A car left
anywhere stays as a `player`-origin entry. The last one exited becomes the **saved car**
(5.7). It is solid to traffic (the obstacle list already includes every vehicle circle),
and traffic now routes around it (5.2).

---

## 5. Sandbox features, prioritised

| Feature | Fun | Cost | Phase |
|---|---|---|---|
| Off-road surfaces, curbs, ramps, sand and water (section 2) | ★★★ | M | 1 |
| Any parked car drivable, generic cockpit (4.1–4.2, 4.4–4.5) | ★★★ | L | 1 |
| Collisions v1: impulse, yaw kick, scrape and impact audio, sparks | ★★★ | M | 1 |
| Chase camera toggle | ★★★ | S–M | 1 |
| Handbrake drifts and skid marks | ★★★ | M | 1 |
| Speedometer HUD | ★★ | S | 1 |
| Recovery key (unstick, back to the road) | ★★ (safety) | S | 1 |
| Traffic reacting: predictive braking, honks, swerve, pass | ★★★ | M | 2 |
| Pedestrians dodging and stepping aside | ★★★ (needed once you can drive on sidewalks) | M | 1 (basic), 2 (full) |
| Traffic cars drivable, the driver gets out | ★★★ | L | 2 |
| Radio, 3 generative stations | ★★★ | M | 2 |
| Minimap | ★★ | S–M | 2 |
| Saved car | ★★ | S | 2 |
| Knockable props (bins, news boxes, barricades, beach chairs) | ★★ | M | 2 |
| Damage-lite: dents and lamp breaks on the player's car | ★★ | M | 2 |
| Outer ring: Ocean Drive ±960, Collins Ave | ★★ | L | 2 |
| Time trial along Ocean Drive | ★★ | S | 3 |
| Ride-share drop-offs | ★★ | M | 3 |
| Parking challenge (valet the car into a bay) | ★★ | S | 3 |
| Photo mode (hide HUD, free camera, depth of field) | ★★ | S | 3 |
| Washington Ave and Collins traffic | ★ | L | 3 |
| Door swing, "Exiting Car" clip, on-foot third person | ★ | M–L | 3 |

Pedestrian avoidance in phase 1 is not optional. Once cars can mount sidewalks and the
promenade, people must step aside before phase 1 ships.

### 5.1 Collisions: impulse, scrapes, sparks, knockable props (`src/vehicles/sim.js`, a new `src/vehicles/contact.js`)

Today `blockedAt()` is a boolean and `substep()` resolves hits by axis-sliding or a flat
bounce (`bounce` 0.06–0.25). Keep `blockedAt()` for terrain rules (step, deep, bounds) and add:

```js
contact(v, x, z, yaw, world) -> { nx, nz, depth, px, pz, obj } | null   // deepest circle-vs-box/circle hit
```

The response in `substep()`:

- Push out by `depth` along the normal.
- `J = −(1 + e) · (vrel·n) / (1/m + (r×n)²/I)`, where `e` is 0.1 for walls, 0.2 for palms and
  lamps, and 0.3 car to car. Apply it to `vx`, `vz` and a new yaw rate (`v.yawV`). A glancing
  hit spins the car.
- Tangential friction scrapes speed off.
- `v.hit = { speed: |vrel·n|, tangent, px, pz, material }` feeds the audio (impact thud over
  2 m/s, metal scrape while the tangential speed is over 1 m/s and it's in contact), the
  camera shake and sparks.
- Sparks: the spray `Points`, with a hot orange colour and a brief emissive boost so bloom
  catches it on high. Only on car-versus-metal or concrete contacts at a tangential speed
  over 3 m/s.

Car versus traffic car: the traffic car is a 1D sim body. Phase 1: it acts as a heavy
obstacle (the player bounces), stops (`v = 0`, a new `c.stunT` 4 s), turns its hazards on
(reusing the tail-lamp material, flashing) and honks. Phase 2: promote a hit traffic car to a
registry body so it actually slides and yaws. Its driver stays seated, puts the hazards on,
then carries on or waits.

Pedestrian colliders are **never** impulse targets. They stay hard blockers with a soft stop
(`lon` → 0 over 0.15 s, no damage, no sparks), and the person startles (5.3).

**Knockable props** (phase 2, a new `src/world/props-dyn.js`):

- **Which props:** trash bins, news boxes, the edge barricades and cones, beach chairs and
  umbrellas, the lifeguard trash barrel.
- **Build:** pull them out of the merged furniture lists in `street.js` `place()` / `furniture()`
  and `beach.js` `props()` into one `InstancedMesh` per type, each with a collider flagged
  `knock: { mass }`.
- **On contact** over 1.5 m/s: disable the collider, launch the prop (the car's velocity × a
  mass ratio, an up kick, a spin), then a ballistic path, ground bounces and sleep.
- **Reset** 90 s later when out of view.
- **Stay solid:** palms, lamp posts, signal poles, pay stations and hydrants. A hydrant does
  not burst.

**Damage-lite** (phase 2, player-driven cars only):

- On entry, clone the LOD0 position attributes of the paint, trim and lamp meshes (about
  2–4 MB).
- On an impact over 4 m/s, push the vertices within 0.35–0.6 m of the contact point inward
  by up to 6 cm with a smooth falloff. That is CPU work only on impact frames, about 1–2 ms.
- Break the head or tail lamp near the hit (emissive off, a darker lens colour).
- On despawn, dispose of the clones.

### 5.2 Traffic reacting to the player (`src/world/traffic-sim.js`, `traffic.js`)

- **Predictive braking.** In `leader()`, test each obstacle at its position plus its velocity
  over 1.2 s, not just where it is now. The obstacles from `main.js` `trafficObstacles()`
  then need `vx` and `vz`. Cars brake for a car that is *about to* cut into the lane.
- **Honks.** Keep the existing blocked-over-4-s honk. Add an immediate short "startle" beep
  when the gap to an obstacle closes at more than 6 m/s, or the player crosses the lane less
  than 1.5 s ahead. Rate-limit it per car (8 s). The seated driver plays `drive_honk` (the
  crowd driver update).
- **Swerve.** Add a lateral offset `c.xOff` (±0.9 m, smoothed) away from an obstacle that
  only partly blocks the lane (`LANE_HALF < |o.x − c.x| < LANE_HALF + r + 0.9`).
  `traffic.js` already positions instances and circles from `c.x`: set
  `c.x = LANE_X[dir] + c.xOff` and add a small yaw from `dxOff/dz`.
- **Pass a stopped obstacle** (phase 2). When blocked for more than 6 s by a static obstacle
  (a parked player car, a person standing in the lane), and the opposite lane is clear for 60
  m both ways, swing out (`xOff` up to 3.5 m) and back. Oncoming cars treat a passing car as
  an obstacle in their lane. This fixes today's deadlock, where a car honks and waits
  forever.
- **Collins lanes** (phase 3): generalise `LANE_X` and `END_Z` into a `LANES` list
  (`{ x, dir, z0, z1 }`), and make the loop re-entry viewer-relative (re-enter at the loop end
  furthest from the viewer, out of sight). `END_Z` must also move out once the extent passes
  ±460 (phase 2).

### 5.3 Pedestrians stepping aside (`crowd.js` `steer()` / `obstaclesFor()`, frozen file)

`obstaclesFor()` already lists vehicle circles within ±10 m, and `steer()` sidesteps within
the lane corridor (`path.half`). But the look-ahead scales with the *person's* speed, and the
corridor is narrow. Add a **threat pass** before the lane steering:

- For each vehicle faster than 1.5 m/s within 25 m, compute the time to closest approach
  (`t`) and the miss distance (`d`).
- If `t < 2.2 s` and `d < 1.6 m`: `A.state = 'dodge'`. Pick the side away from the vehicle's
  velocity, and lift the corridor limit to `path.half + 2.5` (still clamped against the
  static grid). Target speed goes to `run_slow` for about 0.8 s.
- Then `look`: `idle_looking_around` facing the car for 1 s. Then rejoin the lane.
- Crossers: `roadClear()` also checks the player's vehicle (it only checks `getCars()`
  today), so nobody steps out in front of the player.
- Seated people stay seated. The chairs and tables around them block the car.

Test: `crowd-test` "pedestrians clear a car's path at 30 km/h on the promenade and the
sidewalk: min distance ≥ 0.8 m, never in contact".

### 5.4 Handbrake drifts and skid marks

- **Drift.** Today the yaw is purely kinematic (`yaw −= lon·tan(steer)/wb·h`) and the lateral
  speed decays exponentially. Add a yaw-rate state `yawV`:
  - It relaxes toward the kinematic rate at `k = rearGrip · 8`.
  - With the handbrake (or throttle-on oversteer for the coupe and hero), the rear grip
    drops to 0.25. The yaw moment `lon · steer · 0.6` lets the tail step out, and
    counter-steering holds the angle.
  - The existing `lat *= exp(−h · grip · (hb ? 0.3 : 1))` stays the lateral damping.
  - The ATV and bike keep the kinematic model.
  - Tune on the sedan so the turning circle and steer-lock tests in `vehicle-sim-test` still
    pass with no handbrake.
- **Skid marks** (a new `src/vehicles/skids.js`): one `Mesh` with a dynamic ring buffer of
  quads (2000 segments on high, 800 medium, 300 low), one draw call.
  - Emit per rear wheel (all four when braking) while the slip speed is over 2 m/s, the
    wheels are locked, or the handbrake is on at speed.
  - Asphalt gets dark rubber, grass torn darker green, and sand lighter churned ruts (with a
    small normal tilt). The alpha fades over 60 s.
  - The update touches only the new segments (`addUpdateRange`).
- **Tyre smoke:** the spray `Points` in grey, at low density.

### 5.5 Camera: a third-person chase camera (a new `src/vehicles/camera.js`)

- **V** toggles first person and chase (touch: a small camera button).
- **Spring arm:** length 5.5 m (hatch) to 7 m (pickup), height 1.9–2.4 m. The yaw follows
  the velocity heading with a lag, and the FOV widens with speed.
- **Mouse orbit:** mouse or drag orbits the camera, and it re-centres after 1.4 s (the
  existing `lookIdle` logic).
- **Collision:** sample 6 points along the arm against the static grid (the hotel
  footprints, walls and tower). Shorten the arm and never clip into the facades. Ignore thin
  circles (palm trunks and lamps under 0.3 m) so the camera doesn't jitter through a row of
  posts.
- **Body in view:** in chase view the player's driver body must show its head (the hero's
  `attachDriver` update scales the head to 0.001 for first person; make that
  mode-dependent), and the hero's `uInside` screen shader must be off.
- `vehicles/index.js` `eyeWorld()` / `headQuat()` get a mode switch *(frozen file)*.

On foot the player has no body. Third person on foot needs a player avatar, which is
phase 3.

### 5.6 HUD: speedometer and minimap (a new `src/ui/hud.js`)

- **Speedometer**, bottom right, only in vehicles: large numerals in mph (km/h via a toggle
  or `?units=kmh`), the gear letter and a thin arc. Same font and shadow as `#ride-prompt`.
  Hidden in `?shot`. In the hero in first person the real dial exists, so default the HUD
  speedometer to off there.
- **Minimap**, bottom left, a 150 px circle:
  - The static layer is drawn once from `layout.js` and `EXTENT` (roads, cross streets,
    Collins, the park, sand, the ocean, the towers) to an offscreen canvas.
  - Each frame: one rotated `drawImage` plus markers (you, the saved car, time-trial gates,
    the passenger's destination). That is about 0.1 ms.
  - North up or heading up (a toggle). N hides it.
  - Warm translucent colours. No radar sweep, no game-like frame.
- The existing `#hud` (fps readout) stays as it is.

### 5.7 The saved car

When the player exits a car, write `localStorage['ocean-drive.car'] = { body, color, x, z,
yaw, damage }`. On load, if it is inside `EXTENT`, the registry places that body there
(the hero goes back to its bay unless it is the saved car). A minimap marker shows it. This
is session continuity only: no garage, no economy.

### 5.8 Radio (a new `src/audio/radio.js`)

Three generative stations in the style of `music.js`, which already generates bossa nova
from `genPhrase()`. The names are invented; check they don't match real Miami call signs or
brands.

1. **Bossa at dawn:** reuse the `music.js` phrase engine, with a drier mix.
2. **Sunrise synth:** FM pads, an arpeggiator, a soft kick and hat at 96 bpm, in slow chord
   cycles.
3. **Clave:** a Latin groove (3-2 clave, conga and bongo synthesis, a tumbao bass, a
   generated piano montuno).

Plus "off".

- R steps through the stations. A short tuning sweep of filtered noise plays between them.
- It plays through a cabin filter: a speaker band-pass and a small cabinet resonance. For
  the convertible and at speed, the wind noise masks it more.
- It ducks the patio music by 6 dB while on. Outside the car it plays positionally from the
  car at a low level for 10 s, then stops.
- The audio thread does the work. The main-thread scheduling is under 0.1 ms per frame.
- Stations start only on the first R press. `audioVoices: 'reduced'` (low tier) runs one
  station at a time with a simplified mix.

### 5.9 Recovery (Backspace; touch: hold the camera button)

When stuck (bogged, stalled, on the roof after a ramp, or wedged): fade to the haze colour
for 0.4 s, then place the car with the existing `api.place()` sliding search on the nearest
road point outside the lanes, facing along the road, at rest, with the engine running.
Rate-limited to once every 5 s.

### 5.10 Sandbox beats (phase 3)

- **Time trial along Ocean Drive:** from the 12 ST line to the 6 ST line. Start by stopping
  at a small curbside timing kiosk. Checkpoints are the cross streets (a soft ground chevron
  and a minimap marker, no floating rings). Best times go to `localStorage`, and a ghost is
  optional.
- **Ride-share drop-offs:** a pedestrian at the curb raises a hand (the `wave` clip) and a
  marker shows on the minimap. Pull up beside them and stop: they get in (the body is
  hidden, a door sound plays) and the destination marker shows. Drop them at the curb: they
  get out and walk off (the same exit code as 4.3), and a small "★★★★☆ smooth ride" note
  appears. Smoothness is scored from the jerk and bumps, not from the speed.
- **Valet parking:** park the car in a highlighted bay within a time.
- **Photo mode:** P hides the HUD and gives a free camera within 30 m, with exposure and
  depth of field. It reuses `post.js`.

---

## 6. Phased implementation plan

The phases are sequential, as in the brief. Every task keeps `?shot=1` output identical;
verify with `tools/shots.mjs` against the committed shots.

### Phase 0: prep (can start during the freeze; no frozen files)

1. **`src/vehicles/specs.js`** (new): move `SPECS` out of `sim.js`, add the modern bodies
   (4.4), the `SURF` table, `intake`, `offroad`, `mass` and N-speed ratios. `sim.js`
   re-exports `SPECS` for compatibility with the existing tests.
2. **`src/world/extent.js`** (new): `EXTENT` per tier, `insideWorld()`, `edgeDistance()`.
   Phase 1 extent: Ocean Drive z ±560, the near cross streets to x −90, the beach to the
   wade limits.
3. **`src/vehicles/sim.js`:**
   - the surface table (2.2), sinking, the stall, curb mounting;
   - `contact()` plus the impulse response and `yawV` (5.1, 5.4);
   - `'bounds'` via `insideWorld`, and delete `maxGround`, `x0At` and `xMin`;
   - an optional `disabled` flag honoured by the `buildGrid()` query;
   - a per-frame prefilter of `world.dynamic()` to within 12 m of the vehicle (perf, 7).
4. **`src/world/layout.js`:** `RAMPS`, `rampHeight()` inside `groundHeight()`, and
   `surfaceNoise()`.
5. **Node tests** (see 7.4): `vehicle-sim-test.mjs` updated, plus a new `offroad-sim-test.mjs`
   and `collision-test.mjs`.

#### Phase 0 status (done, behind a flag)

Everything above landed without touching the frozen files, behind **`OPEN_WORLD`** in
`src/vehicles/specs.js`, default **off**: `?openworld=1`, `globalThis.OPEN_WORLD = true`
before load, or `OPEN_WORLD=1` in Node (`?shot=1` forces it off). With it off, `specFor()`
returns today's `SPECS` and `vehicle-sim-test` output is byte-identical to before. The open
path is keyed on `spec.open`, so the Node tests build open vehicles directly
(`createVehicle(OPEN_SPECS.sedan, …)`) without the flag. Phase 1 flips the default.

- `SPECS` moved to `specs.js` (re-exported by `sim.js`); `OPEN_SPECS` has bike, atv, hero,
  classic and the seven modern bodies; `SURF`; `specFor(kind, open)`.
- `sim.js`: `contact()` with impulses, friction and `v.yawV`; `v.hit`; curb mounting
  (`v.curb`); per-wheel `v.sink` and `v.bogged`; the stall (`v.stalled`, `canRestart(v)`);
  the swash drift; the soft edge (`v.edge`, `v.outsideT`); the seawall stairs stay
  bike-only; a once-per-frame 12 m prefilter of `world.dynamic()` (also on the legacy path;
  results unchanged); substeps capped at 0.15 m / 16 (`world.maxSubsteps` overrides it);
  `buildGrid()` skips `disabled` items; `createVehicle()` takes a spec object; the gearbox
  takes `ratios.length`.
- `extent.js`: `EXTENT`, `insideWorld()`, `edgeDistance()`, `softDistance()` (only the open
  road ends taper; the hotel line and the sea are hard sides), `edgeFactor()`, `edgeSteer()`,
  `extentBounds()`.
- `layout.js`: `RAMPS`, `RAMP_X`, `rampAt()`, `rampHeight()`, `surfaceNoise()`,
  `groundHeightOpen()`. **`groundHeight()` itself is unchanged**: only the open sim adds the
  ramps until `beach.js` cuts the wall for them (1.1).
- Tuning that departs from the tables above: water drag is `(1 + 6·depth)·offroad scale`
  (with `30·depth` no car can wade past ~8 cm); dry-sand drag is 1.2 and grass 1.2 at
  offroad 0.6; the hero's 0–100 is 14.5 s, not 12, so its 0–50 stays inside
  `vehicle-sim-test`'s 6–11 s.
- With `OPEN_WORLD=1`, `vehicle-sim-test` fails exactly the expected assertions: both curbs,
  the 70 km/h cap and top gear rpm, the ATV water depth and wading-limit runs (the ATV now
  stalls at 0.40 m), "ATV cannot climb the steps" (stops at x 13.18 against the 13.3
  threshold, which assumed `xMin`), and the turning-circle run (its stand-in world sits at
  x 0, which is now park grass; move it to x −18).

#### Phase 1 hooks needed (frozen files)

- `src/vehicles/index.js`
  - `createVehicles()` `world`: add `tier` (the quality tier), and optionally
    `maxSubsteps: 8` on low. `bounds` stays for the bike's legacy path.
  - The car starter: after a stall (`v.stalled`), allow the `startT` restart only when
    `canRestart(v)`; the ATV needs a starter too (it now has `engineOn` gating).
  - `readInput()`: add `edgeSteer(v.x, v.z, v.yaw, tier)` to the steer while riding.
  - `update()`: the turn-back fade when `v.outsideT > 3`, via the recovery path (5.9).
  - Feed `v.hit` (impact thud, scrape, sparks, camera shake), `v.curb` (thump), `v.bogged`
    and `v.stalled` to audio and the spray; enable the water spray for cars.
  - `findNear()` / `mount()`: build modern bodies with `createVehicle(specFor(body), …)`.
- `src/world/crowd.js`, `src/world/people.js`: tag person colliders `person: true`. The sim
  falls back to "an ownerless circle under 0.6 m is a person", which also catches any small
  ownerless prop circle passed as dynamic.
- `src/world/cars-glb.js`: `buildFleet()` sets `disabled` on a taken spot's collider box (the
  grid honours it); clamp the probe to `extentBounds()` instead of `DISTRICT`.
- Not frozen, but Phase 1: `beach.js` `seawallAccess()` cuts `RAMPS` (plus cheek walls at
  `r.z ± (r.hw + 0.1)`, as `offroad-sim-test` builds them), then `groundHeight()` switches
  to `groundHeightOpen()`; `walker.js` uses `insideWorld` / `softDistance` and skips
  `disabled` colliders.

### Phase 1: freedom and feel (after the visual round lands)

| # | Task | Files |
|---|---|---|
| 1.1 | Beach ramps: the seawall cuts, ramp meshes and cheek walls | `beach.js` `seawallAccess()`, `layout.js` |
| 1.2 | Extent in the walker and main; the patio line becomes the footprint colliders only; diegetic edges at z ±560 | `walker.js` `blocked()` / `update()`, `main.js` `walkWorld`, new `world/edges.js` |
| 1.3 | Shadow box follows x as well | `sky.js` `placeShadow()` |
| 1.4 | Registry; parked modern cars and classics enterable; door-point prompt; E/F; passenger-side slide; exit anywhere | new `vehicles/registry.js`, `vehicles/index.js` *(frozen)* `findNear` / `mount` / `dismount` / `update`, `cars-glb.js` *(frozen)* `buildFleet` (a `taken` flag, spot data, instance hide), `trafficKit.makeModern` |
| 1.5 | Generic cockpit: the steer object, eye anchor, headliner, binnacle, door cards; re-export and optimise | `blender/modern.py` `interior()` / `build()`, `build_cars.py`, `tools/optimize-cars.mjs`, `public/models/parked.glb` |
| 1.6 | Player body in modern cars (`makeDriver` with the player's character on `<kind>_driver_pelvis`) | `crowd.js` *(frozen)* `attachDrivers` |
| 1.7 | Parametric engines (`i4`, `v6`, `v8mod`, `v8classic`), surface layers, impact, scrape and curb sounds, the player's horn (H) | `audio/vehicles.js`, `audio/index.js` |
| 1.8 | Collisions v1: impulse, yaw kick, sparks, camera shake; traffic car stun and hazards | `sim.js`, new `vehicles/contact.js`, `vehicles/index.js` (spray colour), `traffic-sim.js` `stunT`, `traffic.js` hazards |
| 1.9 | Chase camera (V), arm collision, head shown in chase view | new `vehicles/camera.js`, `vehicles/index.js` *(frozen)* |
| 1.10 | Drift yaw dynamics and skid marks | `sim.js`, new `vehicles/skids.js` |
| 1.11 | Speedometer HUD and recovery (Backspace) | new `ui/hud.js`, `vehicles/index.js` |
| 1.12 | Pedestrians: the basic threat pass and dodge; crossers check the player's car | `crowd.js` *(frozen)* `steer()`, `roadClear()` |
| 1.13 | Touch: a camera button; Brake becomes handbrake on hold; the Drive/Exit labels become "Enter" | `player/touch.js` `setRide()` |
| 1.14 | Tests updated and extended; perf gate | `tools/*` (7.4) |

Phase 1 is done when the player can walk up to any parked car, get in at the door, drive it
over the curb, across the park and down a ramp onto the beach, get bogged in dry sand and
rock free, stall it in the surf, bump a palm with sparks and a scrape, drift with the
handbrake leaving marks, switch to chase view, and get out anywhere. No pedestrian may ever
be touched, `?shot` frames must be unchanged, and the driving CPU p95 on the 4060 must stay
at 8 ms or less.

#### Phase 1 status (done; `OPEN_WORLD` on by default, `?openworld=0` / `?shot=1` off)

- **In:** 1.1 ramps at z −95 and **+112** (the planned +95 approach is blocked by park palms),
  wall and colliders cut, cheek walls, `groundHeightOpen` for the walker, people, visuals and
  sim; 1.2 walker extent (`insideWorld` / `softDistance`, the cross streets to x −90); 1.3
  shadow box follows x west of −40; 1.4 any parked modern car enterable at either door (E/F,
  touch Enter; the passenger door slides across), spot collider `disabled`, batched instance
  hidden, exit anywhere, six live cars at most (the oldest out of sight goes back to its spot);
  1.5 cockpit in `modern.py` (steer pivot with the grips under it, eye anchor, binnacle and
  needle, full inward headliner, pedals, mirror, door cards) plus lighter glass and cabin trim
  on the driven car; 1.6 the player's body seated in modern cars (`crowd.seatPlayer`); 1.7
  parametric engines, surface layers, impacts, scrape, curb, skid, horn (H), door; 1.8
  impulses, sparks, camera jolt, traffic bump with hazards (`stunT`); 1.9 chase camera (C / V,
  touch button) with arm collision, head shown; 1.10 handbrake drift yaw and pooled skid marks;
  1.11 HUD (`src/ui/hud.js`, `?units=kmh`) and recovery (R / Backspace) with the turn-back
  fade; 1.12 threat pass and dodge, crossers check the player's car, `person: true`; 1.13 touch
  camera button, Brake held = handbrake, Enter label; 1.14 tests. Low tier: 8 substeps, 300 skid
  segments, fewer particles, no tyre smoke, sparks not HDR.
- **Deferred to phase 2:** the saved car (5.7) and its `any-car-test` persistence check;
  classics in the parked pool (none are parked today); standing and seated people don't dodge
  (the car stops for them); the dodge's "look at the car" beat; the coupe / hero throttle
  oversteer; a hinged door swing (phase 3 as planned).
- **Perf (RTX 4060, 1080p high, `perf-primary`):** GPU median 6.35 ms; the open-world drive
  (SUV, chase view) CPU work p95 4.6–6.4 ms per second away from the densest blocks, 9–12 ms
  among the parked rows. The hero's first-person view stays at ~10 / 14 ms (p50 / p95) with or
  without the open world: its rear-view mirror is a second scene pass (now every other frame on
  high, traffic at LOD1 in it) and its LOD0 cabin is ~100 draws.

### Phase 2: the world reacts, and it gets bigger

| # | Task | Files |
|---|---|---|
| 2.1 | Traffic cars enterable when stopped; the driver gets out, reacts and walks off | `traffic-sim.js` `detach()`, `traffic.js` `handOff()` / `bind()`, new `world/exit-driver.js`, `crowd.js` *(frozen, after the round)* person and free-walker API |
| 2.2 | Traffic reactions: predictive braking, startle honks with `drive_honk`, swerve (`xOff`), passing stopped obstacles | `traffic-sim.js` `leader()` / `update()`, `traffic.js`, `main.js` `trafficObstacles()` (velocities) |
| 2.3 | Pedestrians, full: dodge off-corridor, a look-back, sidewalk panic avoidance near slow cars | `crowd.js` |
| 2.4 | Radio (3 stations, R), cabin filter, patio ducking | new `audio/radio.js`, `audio/index.js` |
| 2.5 | Minimap (N) and saved car | `ui/hud.js`, new `ui/minimap.js`, `vehicles/registry.js` |
| 2.6 | Knockable props | new `world/props-dyn.js`, `street.js` `place()` / `furniture()` / `districtFurniture()`, `beach.js` `props()` |
| 2.7 | Damage-lite on the player's car | new `vehicles/damage.js` |
| 2.8 | Hit traffic cars become registry bodies (they slide and yaw) | `registry.js`, `traffic.js` |
| 2.9 | Outer ring B and C: Ocean Drive ±960 (far row colliders, furniture, palm far-LOD), Collins Ave corridor; `placeholders.js` carves the corridor; LOD by x as well; traffic `END_Z` out and viewer-relative | new `world/outer.js`, `placeholders.js` `inRoad()`, `lod.js`, `extent.js`, `traffic-sim.js`, `main.js` (a loader stage) |

#### Phase 2 status

- **Step A fixes:** the hero's rear-view mirror every 4th frame at 256x64 with a whitelist
  (sky, buildings, street, palms, sea, opaque parked batches, traffic at LOD1 within 70 m;
  180 m far; skipped off-screen and on shadow frames); static BatchedMesh culling from
  precomputed spheres, in 32-instance chunks; parked glass as back / front batches; traffic
  LOD1 collapsed to 5 draws; the driven modern car's light glass only from the driver's seat
  (the SUV roof reads solid from outside); spray as soft stretched droplets and mist, plus a
  foam ring and wake round the wheels in the surf.
- **In:** 2.1 enter a stopped traffic car at its driver's door (`traffic.handOff()`,
  `sim.detach()`, `world/exit-driver.js`: out, wave, walk off to the sidewalk); 2.2 predictive
  braking, startle beep with `drive_honk`, swerve (`xOff` ≤ 0.9 m), passing a static
  obstacle after 6 s through a clear other lane; 2.3 (part) standing people turn, watch and
  back out of a car's line, seated people follow it with their head; 2.4 radio (`audio/radio.js`,
  three stations, **Q** not R, touch button, cabin filter, patio ducked 6 dB); 2.5 minimap
  (`ui/minimap.js`, N / Shift+N) and the saved car (`localStorage['ocean-drive.car']`, the
  any-car-test persistence checks); 2.6 knockable bins, news boxes, barricades and cones
  (`world/props-dyn.js`); 2.7 dents (`vehicles/damage.js`, kept with the saved car); soft
  road-closed barricades at the world's ends (`world/edges.js`); four parked classics in the
  curb rows (scenery).
- **Deferred:** 2.8 hit traffic cars as registry bodies; 2.9 the outer ring (Ocean Drive to
  ±960 m and the Collins Ave corridor): walking CPU p95 sits at 5.5–7.5 ms and the hero cockpit
  at 6–8 ms, too little headroom for twice the street furniture, parked rows and palms, so it
  moves to phase 3 with the LOD-by-x work; parked classics enterable; broken lamps on a dent;
  the dodge's look-back for walkers; beach props (chairs, umbrellas) knockable.
- **Perf (RTX 4060, 1080p high, `perf-primary`, final run):** GPU median 6.3 ms; CPU work
  p50 / p95 walking 3.0 / 3.8, hero cockpit 5.6 / 7.6 (was 9.7 / 13.7), SUV drive 4.1 / 5.5
  (was 9–12 p95 in the parked rows). Run to run the cockpit p95 moves between ~6 and ~8.5 ms.

### Phase 3: reach and beats

| # | Task | Files |
|---|---|---|
| 3.1 | Washington Ave; Collins traffic lanes (a `LANES` list) | `world/outer.js`, `traffic-sim.js`, `traffic.js` |
| 3.2 | Time trial, ride-share drop-offs, valet parking, photo mode | new `sandbox/*.js`, `ui/hud.js`, `crowd.js` |
| 3.3 | Hinged front doors; a Mixamo "Exiting Car" clip; on-foot third-person avatar | `blender/modern.py`, `tools/build-people.mjs`, `walker.js`, `crowd.js` |
| 3.4 | Polish: palm shake on impact, tyre smoke, rear-view mirror for modern cars (high tier only) | `palms.js`, `vehicles/skids.js`, `cars-glb.js` |

---

## 7. Risks and mitigations

### 7.1 CPU budget (about 7–8 ms while driving on the 4060)

The current costs to watch are in `blockedAt()`. It runs 1–5 times per substep, and there
are up to 12 substeps per frame. The car has 11 circles, and each circle scans the grid cell
**and all of `world.dynamic()`**: about 150 traffic circles, about 60 people and the other
vehicles. That is up to about 60k distance tests per frame in a crash.

Mitigations:

- Prefilter `dyn` once per frame to the vehicle's AABB plus 12 m (drops it to under 20).
- Early-out circles against a whole-body bounding circle first.
- Only the ridden car and moving bodies step.
- Traffic and pedestrian avoidance only consider vehicles within 25 m.
- Skid marks update only the new segments.
- The minimap is one blit.
- The radio runs on the audio thread.

Expected additions: sim +0.3–0.6 ms, camera arm 0.05 ms, pedestrian threat pass 0.1 ms,
traffic prediction under 0.05 ms, HUD and minimap 0.1–0.2 ms, props 0.1 ms. That is about
1–1.2 ms total, within the budget if the baseline driving frame is at 6.5 ms or less today.
Measure it first with `tools/car-perf.mjs` / `perf-primary.mjs`, and add a CPU p95 gate for
a scripted 60 s drive.

- **Shadow re-renders.** At driving speed the sun shadow is re-rendered up to 5 times a
  second (`SHADOW_GAP` 0.2 s, `shadowStep`). The outer ring adds casters, so the cost of each
  re-render grows. Keep new outer-ring meshes off `castShadow` on medium and low, and batch
  them.
- **Memory.** Each promoted car adds an instance (shared geometry, its own paint material,
  the same program). With damage it adds 2–4 MB of cloned attributes. The cap is 6 live
  cars.
- **Mobile.** Low tier: extent ±560 plus Collins ±300 without palm shadows, 8 traffic cars,
  300 skid segments, no sparks bloom, one radio voice, and the chase camera at FOV 60 to
  keep the fill down. Dynamic resolution already protects the GPU. Watch the CPU on
  mid-range Android: the sim substeps scale with speed, so cap substeps at 8 on `low`.

### 7.2 Collision tunnelling

The substep count is `ceil(speed·dt / 0.08)`, capped at 12, and `dt` is clamped to 0.05.
At the new top speed of 195 km/h (54 m/s) and 20 fps: 2.7 m / 12 = 0.23 m per substep. The
thinnest blockers: lamp posts are r 0.14 + a 0.62 corner circle = 0.76 m, and the seawall
cheek walls are 0.2 m + 0.62 m. That is safe, but the margin is thin at low frame rates.

Mitigations:

- Cap the substep length at `min(0.08·speed·dt, 0.15 m)` with a 16-substep ceiling on
  high and medium.
- Below 25 fps, lower the top speed rather than growing the step.
- Keep the existing "no tunnelling" tests (lamp post, parked car, seawall, the 10 cm wall)
  and add 54 m/s runs at `dt = 1/20`.
- `contact()` pushes out by `depth`, so a deep overlap resolves instead of sticking. Keep
  the `overlapping()` escape for dynamic circles.

### 7.3 Gameplay and tone

- **Pedestrian safety** is an invariant: the car can never be inside a person's circle.
  Keep people as hard blockers, add early dodges, and test it.
- **Traffic deadlocks** around parked player cars: passing (5.2), plus the registry returns
  abandoned cars that sit in a lane after 2 minutes out of view.
- **Stuck states** (sand, water, wedged): the recovery key and the turn-back fade.
- **Touch driving.** One stick for both throttle and steering makes drifting hard. Phase 1
  keeps the stick and makes Brake a hold-to-handbrake. Phase 2 can add an optional driving
  layout: a steer slider on the left and gas and brake pads on the right. `mobile-test`
  must cover both.
- **The critic look.** The chase camera shows the cars from outside at close range. The
  modern GLBs were modelled for the curb rows. Budget one visual pass on the three most
  common bodies in chase view.

### 7.4 Tests

Existing assertions that **will change on purpose**. Update them in the same commit as the
behaviour:

- `vehicle-sim-test.mjs`:
  - "car stopped by the park-side curb" and "car stopped by the hotel-side curb" become
    "the car mounts the curb below 15 km/h with a bump; it loses at least 40 % of its speed
    at 50 km/h".
  - "ATV stays on the beach (x ≥ 12.9 + radius)" and "ATV cannot climb the access steps"
    become "the ATV still cannot climb the steps; it reaches the park via the z −95 ramp".
  - "car top speed ~70 km/h" gets hero-specific bounds from the new spec.
- `ride-test.mjs`: the same three (park-side curb, hotel-side curb, the ATV in the park),
  plus "car reaches ~60–70 km/h" for the hero's new top speed.
- `car-ride-test.mjs`: the prompt text ("drive" becomes "enter"); `walker.world.bounds`
  stand-ins keep working through `extent.js` defaults.
- `walk-test.mjs`: the patio line and z ±340 soft end move. Add "walk down 10 ST to x −85".
- `mobile-test.mjs`: the Drive/Exit and Brake labels, plus the new camera button.

New tests:

- `tools/offroad-sim-test.mjs` (Node):
  - the speed on grass and the promenade per body;
  - the sedan bogs in dry sand at full throttle and rocks free;
  - the pickup does not bog;
  - wading stalls the sedan at about 0.35 m and not the pickup;
  - the swash drift;
  - ramp climbs.
- `tools/collision-test.mjs` (Node):
  - glancing versus head-on impulses (a yaw kick, no energy gain);
  - no tunnelling at 54 m/s and `dt = 1/20` against a lamp, a palm, the seawall and a
    parked car;
  - a car never inside a pedestrian circle over 500 randomised runs.
- `tools/any-car-test.mjs` (Node, DOM stubbed like `car-ride-test`):
  - enter a parked sedan at its door;
  - its BatchedMesh instance hides and its collider is disabled;
  - drive and exit anywhere;
  - the saved car persists through a stubbed `localStorage`.
- `traffic-sim-test.mjs`:
  - predictive braking for a crossing obstacle;
  - a startle honk;
  - a swerve stays within the lane;
  - passing a parked car without a head-on;
  - `detach()` respawns the slot.
- `crowd-test.mjs`: a car at 30 km/h on the promenade and the sidewalk; people clear it with
  a min distance of 0.8 m or more and zero contacts.
- A perf gate: a scripted 60 s drive on high, where the frame CPU p95 must be 8 ms or less
  and the shadow re-renders 5 per second or fewer.

---

## 8. Key files, at a glance

- **Physics:** `src/vehicles/sim.js` (surfaces, curbs, stall, `contact()`, `yawV`, bounds),
  new `specs.js`, `contact.js`, `skids.js`, `camera.js`, `registry.js`, `damage.js`.
- **Vehicle glue:** `src/vehicles/index.js` *(frozen)*: `findNear`, `mount`, `dismount`,
  `readInput`, `update`, `eyeWorld` / `headQuat`.
- **Cars:** `src/world/cars-glb.js` *(frozen)*: `buildFleet` (taken instances, spot data),
  `trafficKit.makeModern`, probe clamp. `blender/modern.py` `interior()` / `build()` (steer
  object, eye, headliner, binnacle, doors).
- **Traffic:** `src/world/traffic-sim.js` (`leader`, `detach`, `xOff`, passing, `LANES`),
  `src/world/traffic.js` (`handOff`, hazards, yaw from `xOff`).
- **People:** `src/world/crowd.js` *(frozen)*: `steer`, `obstaclesFor`, `roadClear`,
  `attachDrivers` / `makeDriver`. New `src/world/exit-driver.js`.
- **World:** `src/world/layout.js` (`RAMPS`, `groundHeight`), `beach.js` (`seawallAccess`,
  `props`), new `extent.js`, `edges.js`, `outer.js`, `props-dyn.js`. Also `placeholders.js`
  (the Collins corridor), `street.js` (knockables), `lod.js` (x-aware), `sky.js`
  (`placeShadow(x, z)`).
- **Player:** `src/player/walker.js` (extent), `touch.js` (buttons).
- **Audio:** `src/audio/vehicles.js` (`makeEngine` profiles, surface layers, impacts, horn),
  `traffic.js` (profiles), new `radio.js`.
- **UI:** new `src/ui/hud.js`, `minimap.js`.
- **Main:** `src/main.js` (`walkWorld`, obstacle velocities, loader stage, the new keys
  E/F, V, H, R, N, Backspace, P).
