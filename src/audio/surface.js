// Ground surface lookup for footsteps. Reads layout constants when present, with fallbacks.
import * as L from '../world/layout.js';

const num = (v, d) => (typeof v === 'number' ? v : d);

// y = feet height (m). Returns 'pavement' | 'grass' | 'sand' | 'wetsand' | 'wood'.
export function surfaceAt(x, z, y = 0, waterlineX) {
  const WL = num(waterlineX, num(L.SAND?.waterline, 90));
  const tx = num(L.TOWER?.x, 45), tz = num(L.TOWER?.z, 5);
  if (y > 0.5 && Math.abs(x - tx) < 3.5 && Math.abs(z - tz) < 4.5) return 'wood';
  const parkX0 = num(L.PARK?.x0, -10), parkX1 = num(L.PARK?.x1, 12);
  const promX = num(L.PARK?.promenadeX, 0), sandX0 = num(L.SAND?.x0, 12);
  if (x < parkX0) return 'pavement';             // hotel sidewalk, parking, road, park sidewalk
  if (x < sandX0) {
    if (Math.abs(x - promX) < 1.75) return 'pavement'; // promenade path through the park
    if (x > parkX1 - 0.6) return 'pavement';            // park / beach wall cap
    return 'grass';
  }
  if (x >= WL - 6) return 'wetsand';
  return 'sand';
}
