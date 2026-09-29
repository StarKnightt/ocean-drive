// Optimise the raw Blender exports (blender/_raw/*.glb) into public/models/:
// dedup + prune, textures to WebP (<= 1024), Meshopt geometry compression.
// Usage: node tools/optimize-cars.mjs [name ...]   (default: every raw GLB)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const RAW = path.resolve('blender/_raw');
const OUT = path.resolve('public/models');
const TMP = path.resolve('blender/_raw/_tmp');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
const cli = 'npx -y @gltf-transform/cli@4.5.0';
const names = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(RAW).filter((f) => f.endsWith('.glb')).map((f) => f.replace('.glb', ''));
const run = (args) => execSync(`${cli} ${args}`, { stdio: ['ignore', 'pipe', 'inherit'] });
for (const n of names) {
  const src = path.join(RAW, `${n}.glb`);
  const a = path.join(TMP, `${n}-a.glb`), b = path.join(TMP, `${n}-b.glb`), c = path.join(TMP, `${n}-c.glb`);
  run(`dedup "${src}" "${a}"`);
  // the hero's vinyl / carpet get their normal maps at runtime: keep its UVs
  run(`prune "${a}" "${b}" --keep-leaves true --keep-attributes ${n === 'convertible'}`);
  run(`resize "${b}" "${a}" --width 1024 --height 1024`);
  run(`webp "${a}" "${c}" --quality 88`);
  const out = path.join(OUT, `${n}.glb`);
  // the hero is seen from inches away: 14-bit positions opened hairline cracks along the
  // boolean-cut body's T-junctions (black streaks across the hood), coarse normals banded
  const q = n === 'convertible' ? ' --quantize-position 16 --quantize-normal 12' : '';
  run(`meshopt "${c}" "${out}" --level medium${q}`);
  console.log(n, (fs.statSync(src).size / 1024).toFixed(0), 'KB ->', (fs.statSync(out).size / 1024).toFixed(0), 'KB');
}
fs.rmSync(TMP, { recursive: true, force: true });
