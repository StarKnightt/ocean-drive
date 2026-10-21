// The camera chosen per mode, across reloads (localStorage `ocean-drive.view`):
// { foot: 'fp' | 'tp', car: 'fp' | 'chase' }.
export const VIEW_KEY = 'ocean-drive.view';
const DEFAULTS = { foot: 'fp', car: 'fp' };
const VALID = { foot: ['fp', 'tp'], car: ['fp', 'chase'] };

export function loadViewPref(mode) {
  let rec = null;
  try { rec = JSON.parse(globalThis.localStorage?.getItem(VIEW_KEY) ?? 'null'); } catch { rec = null; }
  const v = rec?.[mode];
  return VALID[mode]?.includes(v) ? v : DEFAULTS[mode];
}
export function saveViewPref(mode, value) {
  if (!VALID[mode]?.includes(value)) return;
  try {
    const rec = { foot: loadViewPref('foot'), car: loadViewPref('car'), [mode]: value };
    globalThis.localStorage?.setItem(VIEW_KEY, JSON.stringify(rec));
  } catch { /* private mode */ }
}
