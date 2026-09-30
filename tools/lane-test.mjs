// Node-only check of the hotel-sidewalk lane planner (src/world/lanes.js) on furniture laid
// out as in the game: a sidewalk cafe that fills the sidewalk to the planters with a palm at
// the curb (z 16..21.5, the block where a walker used to get stuck), and the two thin posts
// at the mid-block crosswalk. The lane must keep every obstacle at least r + 0.15 m away (what
// the crowd's steering needs to squeeze past furniture) and stay on the sidewalk, stepping
// into the gutter only briefly round a pinch.
// Usage: node tools/lane-test.mjs
import { hotelLane, LANE_X0, LANE_X1 } from '../src/world/lanes.js';

const tables = [[-27.15, 17.35], [-27.15, 18.88], [-27.15, 20.42], [-25.75, 17.35], [-25.75, 18.85], [-25.75, 20.4]];
const chairs = [[-27.24, 18.02], [-27.23, 16.67], [-26.47, 18.98], [-27.71, 18.74], [-27.12, 21.07], [-27.17, 19.81], [-25.15, 17.36], [-26.41, 17.22], [-25.14, 19.02], [-26.45, 18.86], [-25.76, 21.08], [-25.81, 19.78]];
const cafe = [
  ...tables.map(([x, z]) => ({ x, z, r: 0.42 })),
  ...chairs.map(([x, z]) => ({ x, z, r: 0.27 })),
  { x: -24.65, z: 20, r: 0.3 }, { x: -24.81, z: 16.44, r: 0.26 }, { x: -24.7, z: 18.18, r: 0.26 }, { x: -28.98, z: 16.1, r: 0.36 },
  { x: -24.5, z: 20.5, r: 0.22 },   // the box by the curb palm: a pinch narrower than a person
];
const posts = [{ x: -24.35, z: -12.6, r: 0.08 }, { x: -24.35, z: -12.0, r: 0.08 }];

const results = [];
function check(name, obstacles, z0, z1) {
  const lane = hotelLane(z0, z1, obstacles);
  let worst = Infinity, at = null, off = 0, run = 0, gutter = 0;
  for (let k = 1; k < lane.length; k++) {
    const [ax, az] = lane[k - 1], [bx, bz] = lane[k];
    for (let t = 0; t <= 1; t += 0.1) {
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (x < LANE_X0 - 0.01 || x > LANE_X1 + 0.01) off++;
      run = x > -24.05 ? run + Math.hypot(bx - ax, bz - az) * 0.1 : 0; gutter = Math.max(gutter, run);
      for (const o of obstacles) {
        const c = Math.hypot(o.x - x, o.z - z) - o.r;
        if (c < worst) { worst = c; at = [+x.toFixed(2), +z.toFixed(2), o.x, o.z]; }
      }
    }
  }
  const ok = worst >= 0.15 && off === 0 && gutter < 4;
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify({ clearance: +worst.toFixed(3), at, offSidewalk: off, gutterRun: +gutter.toFixed(2), points: lane.length })}`);
}
check('lane threads the full sidewalk cafe (planters + curb palm)', cafe, 14, 24);
check('lane passes the crosswalk posts', posts, -16, -8);
check('both together, long stretch', [...cafe, ...posts], -20, 26);
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
