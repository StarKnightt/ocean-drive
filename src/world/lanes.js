// A walking line along the hotel sidewalk (x -28.1 .. -23.85: a step into the gutter where the sidewalk pinches) weaving through the
// sidewalk cafes: dynamic programming over a 0.15 m x 0.25 m grid. A cell costs by how far it
// reaches into a person's clearance round a table, chair, planter, lamp, bin or palm (so
// where a whole row is tight - a cafe filling the sidewalk to the planters, a palm at the
// curb - the line takes the least-bad gap rather than any blocked cell), plus a lateral step
// limit, a pull towards the preferred line and a cost for zig-zagging.
// Pure (no three): tools/lane-test.mjs runs it under Node.
export const LANE_X0 = -28.1, LANE_X1 = -23.85, LANE_R = 0.27;
const CURB = -24.05;   // beyond: the gutter, only round a pinch

export function hotelLane(z0, z1, obstacles, { prefer = -26.2 } = {}) {
  const X0 = LANE_X0, X1 = LANE_X1, DX = 0.15, DZ = 0.25, R = LANE_R;
  const nx = Math.round((X1 - X0) / DX) + 1, nz = Math.round((z1 - z0) / DZ) + 1;
  const near = obstacles.filter((o) => o.z > z0 - 2 && o.z < z1 + 2 && o.x > X0 - 1.5 && o.x < X1 + 1.5);
  const blockedAt = (x, z) => {
    let worst = 0;
    for (const o of near) if (Math.abs(o.z - z) < o.r + R) worst = Math.max(worst, o.r + R - Math.hypot(o.x - x, o.z - z));
    return worst > 0 ? 1 + worst * 20 : 0;
  };
  let cost = new Float64Array(nx);
  const prev = [];
  const cell = (i) => X0 + i * DX;
  for (let i = 0; i < nx; i++) cost[i] = blockedAt(cell(i), z0) * 1e4 + (cell(i) > CURB ? 25 : 0) + Math.abs(cell(i) - prefer) * 0.3;
  for (let j = 1; j < nz; j++) {
    const z = z0 + j * DZ, next = new Float64Array(nx), from = new Int16Array(nx);
    for (let i = 0; i < nx; i++) {
      const x = cell(i), here = blockedAt(x, z) * 1e4 + 1 + Math.abs(x - prefer) * 0.3 * DZ + (x > CURB ? 25 : 0);
      let best = Infinity, bi = i;
      for (let d = -1; d <= 1; d++) {
        const k = i + d;
        if (k < 0 || k >= nx) continue;
        const c = cost[k] + (d ? 0.45 : 0);
        if (c < best) { best = c; bi = k; }
      }
      next[i] = best + here; from[i] = bi;
    }
    prev.push(from); cost = next;
  }
  let i = 0;
  for (let k = 1; k < nx; k++) if (cost[k] < cost[i]) i = k;
  const xs = new Float64Array(nz);
  for (let j = nz - 1; j >= 0; j--) { xs[j] = cell(i); if (j > 0) i = prev[j - 1][i]; }
  // light smoothing (3 samples), then every 0.5 m
  const out = [];
  for (let j = 0; j < nz; j += 2) {
    let sx = 0, n = 0;
    for (let k = Math.max(0, j - 1); k <= Math.min(nz - 1, j + 1); k++) { sx += xs[k]; n++; }
    out.push([sx / n, z0 + j * DZ]);
  }
  return out;
}
