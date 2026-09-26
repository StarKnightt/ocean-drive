// Writes a sample spec for a shots/<label> run, then runs tools/sample.mjs on it.
// Usage: node tools/sample-shots.mjs <label>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const label = process.argv[2] || 'latest';
const dir = path.resolve('shots', label);
const R = {
  'shot1-sidewalk-north.png': {
    'sky away top': [0.6, 0.02, 0.8, 0.12],
    'sky away horizon': [0.9, 0.5, 0.98, 0.55],
    'wall lit': [0.28, 0.6, 0.35, 0.7],
    'awning underside': [0.0, 0.12, 0.18, 0.22],
    'sidewalk lit': [0.3, 0.85, 0.5, 0.95],
    'asphalt lit': [0.86, 0.84, 0.96, 0.92],
    'far street end': [0.63, 0.5, 0.67, 0.58],
    'wall shaded side': [0.08, 0.4, 0.2, 0.7],
    'eyebrow underside': [0.4, 0.405, 0.5, 0.425],
  },
  'shot2-hotel-fronts-from-park.png': {
    'wall lit': [0.45, 0.5, 0.55, 0.6],
    'wall palm shadow': [0.5485, 0.52, 0.5545, 0.6],
    'asphalt lit': [0.2, 0.9, 0.45, 0.97],
    'ledge underside': [0.1, 0.345, 0.25, 0.352],
    'fronds top right': [0.8, 0.0, 0.9, 0.05],
  },
  'shot3-park-to-ocean-sun.png': {
    'sky top': [0.1, 0.02, 0.9, 0.12],
    'sky mid': [0.1, 0.3, 0.3, 0.38],
    'near sun': [0.44, 0.33, 0.52, 0.42],
    'glare zone': [0.3, 0.2, 0.7, 0.48],
    'horizon band': [0.05, 0.48, 0.35, 0.51],
    'ocean left': [0.05, 0.53, 0.35, 0.545],
    'ocean under sun': [0.45, 0.53, 0.52, 0.55],
    'sand into sun': [0.05, 0.58, 0.4, 0.64],
    'tower cabin face': [0.625, 0.45, 0.655, 0.495],
    'cloud right': [0.7, 0.39, 0.95, 0.42],
    'grass': [0.1, 0.85, 0.9, 0.95],
    'park wall face': [0.1, 0.7, 0.9, 0.76],
  },
  'shot4-tower-top-looking-back.png': {
    'sky away top': [0.1, 0.02, 0.5, 0.15],
    'sky away horizon': [0.0, 0.27, 0.05, 0.31],
    'sand lit': [0.1, 0.72, 0.4, 0.9],
    'sand shadow': [0.685, 0.64, 0.715, 0.72],
    'mint wall lit': [0.08, 0.36, 0.15, 0.45],
    'peach wall lit': [0.6, 0.38, 0.72, 0.46],
  },
  'shot5-waterline-waves.png': {
    'sky top': [0.4, 0.02, 0.9, 0.1],
    'near sun': [0.17, 0.18, 0.25, 0.29],
    'horizon': [0.5, 0.36, 0.9, 0.39],
    'water right': [0.6, 0.44, 0.9, 0.5],
    'water left of glint': [0.02, 0.5, 0.12, 0.6],
    'glitter column': [0.19, 0.42, 0.25, 0.6],
    'sand': [0.5, 0.8, 0.9, 0.95],
    'wet streak': [0.222, 0.72, 0.232, 0.82],
    'wet beside streak': [0.1, 0.72, 0.18, 0.82],
  },
};
const spec = {};
for (const [f, r] of Object.entries(R)) spec[path.join(dir, f)] = r;
const specFile = path.join(dir, 'sample-spec.json');
fs.writeFileSync(specFile, JSON.stringify(spec, null, 2));
execFileSync('node', ['tools/sample.mjs', specFile], { stdio: 'inherit' });
