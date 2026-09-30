# Changelog

## 2026-09-30: cars, people and the open world

The walk became a drive. The street's cars are now models built in Blender, the 1950s
convertible at the curb can be driven, the drive has traffic, the sidewalks, cafés and benches
have people, and the whole district is an open world: any parked car or stopped traffic car can
be taken, and the car can go over the park lawn, down the seawall ramps, onto the sand and into
the surf. There are no weapons, no fighting and no real brands; taking a traffic car is a
borrowing, and its driver gets out and waves.

### Cars, modelled in Blender

- A hero convertible (a two-tone 1950s car with fins, a chrome spear, wide whitewalls, a
  tuck-and-roll bench, a banded dash cluster with a working speedometer, pedals, wipers, vents
  and a rear-view mirror) and a fleet of seven modern bodies (sedan, SUV, hatch, coupe, pickup,
  wagon, crossover), all authored in Blender by Python scripts in `blender/` and exported as
  Meshopt-compressed GLBs (`public/models/`).
- Each modern body has a generic cockpit (steering pivot and grips, eye anchor, speedo binnacle
  and needle, headliner, pillars, door cards, pedals, mirror) and a collapsed far level of detail.
- The parked fleet is drawn as BatchedMesh LODs with chunked culling; lacquer paint, chrome and
  glass take a local reflection probe; contact shadows are computed textures.

### The drivable convertible

- A sim with a sprung body (squat, dive, roll), a synthesized V8 (starter, lope at idle, load),
  a horn, the driver's view and a chase camera, and touch controls.
- The player's body at the wheel: hands hand-over-hand on the rim with a curled grip, feet on
  the pedals, the head hidden from the driver's eye.

### Traffic

- An IDM traffic sim on the drive, 30 cars of all eight bodies and classic convertibles, stopping
  at the crosswalks for pedestrians, at the cycling 11 ST signal (three-lens heads on a
  Miami-Dade-style mast arm) and for the player, with positional engines, Doppler, brake lights
  with a crimson halo and contact shadows.
- It reacts to the player: predictive braking, a startle beep with the driver's honk gesture,
  swerving round a partial block and passing a car left standing in the lane.

### People and drivers (Mixamo)

- A crowd of walkers, joggers, skaters and people sitting at cafés and on benches, and a seated
  driver in every traffic car, all Mixamo characters with Mixamo animation clips (walks, jogs,
  idles, sitting, talking, phoning, driving, honking, waving), retargeted and optimized into
  `public/models/people/`.
- Grounded with foot contact patches and long low-sun shadows; they dodge vehicles, never
  sidestep into one, and turn their heads to a car coming their way.

### Open world, phase 1

- Enter any parked car at its door (E / F, either side), drive it anywhere, get out anywhere.
- Surfaces: the park lawn, seawall ramps down to the beach, soft sand you can sink and bog in
  (rock it free, or R to recover), wet sand and the shallow surf, where the engine drowns if the
  water reaches the intake.
- Curbs, collisions and impulses against the street furniture; soft world ends that turn you
  back; skid marks on a handbrake slide; a speedometer HUD in the loading card's Art Deco manner.

### Open world, phase 2

- Take a stopped traffic car at its driver's door: the driver gets out, waves and walks off.
- The last car you got out of is saved across reloads, dents included.
- A minimap (heading up or north up, the saved car marked), a car radio with three generative
  stations (Bossa at Dawn, Sunrise Synth, Clave Café), knockable bins, news boxes, barricades and
  cones, road-closed ends, light dents on the modern cars, parked classics in the curb rows,
  and water spray and a foam wake round the wheels in the surf.

### Polish (this release)

- Getting into a car: the camera is in the driver's head from the first frame, and the seated
  body stays hidden until the look has turned (no headless torso or long arms seen from outside).
- A traffic driver getting out: the door swings open and shuts behind them, they have a foot
  contact patch, and they walk off round the car's rear, out of the new driver's way.
- HUD: the riding key hints are small, bottom left, and fade 4 s after getting in; the radio card
  is a transparent caption between gold hairlines that fades after 3 s; the minimap has an
  outline and a drop shadow, a larger chevron, an N badge and lighter roads.
- Skid marks: soft, patchy grey-brown rubber (about 0.35 opacity) on the asphalt only, broken at
  a curb step or a change of surface; ruts in the sand and flattened grass from every tyre.
- Sand and surf: the car sits 8-12 cm into the sand and the water; spray is thin, long streaks
  that glow gold when backlit by the low sun; fine sand is thrown off the tyres on dry sand.
- Dents: each vertex is capped in how far it can be pushed in, with a smooth falloff and normals
  kept on the modelled side, so the grille and panels no longer tear or open black holes.
- World edge: Type III barricades with three striped rails, a sign plate and sandbags; the
  placeholder blocks past the cross streets' barricades fade into the haze.
- Perf on an RTX 4060 at 1920×1080, high tier (`tools/perf-primary.mjs`): GPU median 6.2 ms;
  CPU work p95 by phase: walking 7.9, ATV 5.0, cockpit 5.8, driving 3.7 ms.

### Asset provenance

- **Characters and animations:** Mixamo (Adobe), used under the Mixamo license (free for use in
  projects, including commercial; the raw assets are not redistributed as a standalone library).
  Characters: Bryce, Elizabeth, Lewis, Megan and Sophie; clips as listed above.
- **Normal maps:** Poly Haven, CC0: *Leather White* (the convertible's vinyl) and *Dirty Carpet*
  (the footwells), at 1K, converted to WebP (`public/textures/cars/`).
- **Cars:** modelled in Blender by this project (`blender/*.py`, `blender/cars.blend`).
- Everything else (the hotels, palms, street, beach, ocean, sky, signs and every sound) is still
  generated in code at load time. All hotel names are invented.
