// Optimise the raw Mixamo exports (blender/people.py -> blender/_raw/people/) into
// public/models/people/:
//   <name>.glb / <name>-512.glb   characters (LOD0 + LOD1 on one skin), textures WebP <= 1024 / 512
//   clips.glb                     every animation clip on ONE Mixamo skeleton (retargeted by
//                                 bone name), resampled, long idles trimmed
//   skate.glb                     the roller skate
// Usage: node tools/build-people.mjs [chars] [clips] [skate]
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, resample, prune, dedup } from '@gltf-transform/functions';

const RAW = path.resolve('blender/_raw/people');
const OUT = path.resolve('public/models/people');
const TMP = path.join(RAW, '_tmp');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
const cli = 'npx -y @gltf-transform/cli@4.5.0';
const run = (args) => execSync(`${cli} ${args}`, { stdio: ['ignore', 'pipe', 'inherit'] });
const modes = process.argv.slice(2).length ? process.argv.slice(2) : ['chars', 'clips', 'skate'];
const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';

if (modes.includes('chars')) {
  for (const f of fs.readdirSync(RAW).filter((f) => f.endsWith('.glb') && f !== 'skate.glb' && f !== 'remy.glb')) {
    const n = f.replace('.glb', ''), src = path.join(RAW, f);
    const a = path.join(TMP, `${n}-a.glb`), b = path.join(TMP, `${n}-b.glb`), c = path.join(TMP, `${n}-c.glb`);
    run(`dedup "${src}" "${a}"`);
    // (COLOR_0 carries the clothing zones: keep attributes the materials don't use)
    run(`prune "${a}" "${b}" --keep-attributes true --keep-leaves true`);
    for (const [size, sfx] of [[1024, ''], [512, '-512']]) {
      run(`resize "${b}" "${a}" --width ${size} --height ${size}`);
      run(`webp "${a}" "${c}" --quality ${size > 512 ? 86 : 82}`);
      const out = path.join(OUT, `${n}${sfx}.glb`);
      run(`meshopt "${c}" "${out}" --level medium`);
      console.log(n + sfx, kb(src), '->', kb(out));
    }
  }
}

if (modes.includes('clips')) {
  // clips longer than this are cut (played ping-pong at runtime)
  const MAX_T = { idle_phone_talk_f: 14, idle_phone_talk_m: 14, sit_talking: 16, sit_talking_2: 16, idle_weight_shift_f: 14, sit_drinking: 15.2, idle_breathing: 8.7 };
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const files = fs.readdirSync(path.join(RAW, 'clips')).filter((f) => f.endsWith('.glb')).sort();
  const named = async (f) => {
    const d = await io.read(path.join(RAW, 'clips', f));
    for (const a of d.getRoot().listAnimations()) a.setName(f.replace('.glb', ''));
    return d;
  };
  const doc = await named(files[0]);
  const root = doc.getRoot();
  const base = new Map();
  for (const nd of root.listNodes()) base.set(nd.getName(), nd);
  for (const f of files.slice(1)) {
    mergeDocuments(doc, await named(f));
  }
  // retarget every channel to the base skeleton's node of the same name
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      const t = ch.getTargetNode();
      const b = base.get(t?.getName());
      if (b && b !== t) ch.setTargetNode(b);
    }
  }
  // drop the merged-in skeletons and scenes
  const keep = new Set(base.values());
  for (const sc of root.listScenes().slice(1)) sc.dispose();
  for (const nd of root.listNodes()) if (!keep.has(nd)) nd.dispose();
  // trim the long idles; flatten in-place drift of the hips (locomotion is driven by code)
  for (const anim of root.listAnimations()) {
    const name = anim.getName(), maxT = MAX_T[name];
    for (const ch of anim.listChannels()) {
      // (no tracks on the leaf / eye bones)
      // (and rotations only, except the hips' translation: bone lengths and scales stay the
      // character's own, whatever skeleton the clip was recorded on)
      const tn = ch.getTargetNode().getName(), tp = ch.getTargetPath();
      if (/_End|Eye$/.test(tn) || tp === 'scale' || (tp === 'translation' && !tn.endsWith('Hips'))) { const s = ch.getSampler(); ch.dispose(); s.dispose(); continue; }
      const s = ch.getSampler(), inp = s.getInput(), out = s.getOutput();
      const times = inp.getArray(), vals = out.getArray(), k = out.getElementSize();
      if (maxT) {
        let n = times.length;
        while (n > 2 && times[n - 1] > maxT) n--;
        // (the time accessor is shared by the channels: trim it once, every output to match)
        if (n < times.length) inp.setArray(times.slice(0, n));
        if (vals.length > n * k) out.setArray(vals.slice(0, n * k));
      }
      const locomotion = /^(walk|jog|run)/.test(name);
      if (locomotion && ch.getTargetPath() === 'translation' && ch.getTargetNode().getName().endsWith('Hips')) {
        // (armature frame: the rest hips offset is the up axis, the larger of the other two
        // the forward drift; lateral sway and the vertical bob stay)
        const v = out.getArray();
        const n = v.length / 3;
        const rest = ch.getTargetNode().getTranslation().map(Math.abs);
        const up = rest.indexOf(Math.max(...rest));
        const span = [0, 1, 2].map((c) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < n; i++) { lo = Math.min(lo, v[i * 3 + c]); hi = Math.max(hi, v[i * 3 + c]); } return hi - lo; });
        const fwd = [0, 1, 2].filter((c) => c !== up).sort((a, b) => span[b] - span[a])[0];
        let m = 0;
        for (let i = 0; i < n; i++) m += v[i * 3 + fwd] / n;
        for (let i = 0; i < n; i++) v[i * 3 + fwd] = m;
        out.setArray(v);
      }
    }
  }
  const buf = root.listBuffers()[0];
  for (const a of root.listAccessors()) a.setBuffer(buf);
  for (const b of root.listBuffers().slice(1)) b.dispose();
  await doc.transform(resample({ tolerance: 4e-4 }), dedup(), prune({ keepLeaves: true }));
  const tmp = path.join(TMP, 'clips.glb');
  await io.write(tmp, doc);
  const out = path.join(OUT, 'clips.glb');
  run(`meshopt "${tmp}" "${out}" --level medium`);
  console.log('clips', root.listAnimations().length, root.listAnimations().map((a) => a.getName()).join(' '), kb(tmp), '->', kb(out));
}

if (modes.includes('skate')) {
  const src = path.join(RAW, 'skate.glb'), a = path.join(TMP, 'skate-a.glb');
  run(`dedup "${src}" "${a}"`);
  run(`meshopt "${a}" "${path.join(OUT, 'skate.glb')}" --level medium`);
  console.log('skate', kb(src), '->', kb(path.join(OUT, 'skate.glb')));
}
fs.rmSync(TMP, { recursive: true, force: true });
