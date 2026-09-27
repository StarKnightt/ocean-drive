// Touch controls: a floating joystick under the left thumb (left ~40% of the screen),
// drag anywhere else to look, a jump ring and a small mute button bottom-right.
// Move and look work at the same time (one tracked touch each). The joystick only
// writes walker.stick, so movement keeps the walker's acceleration, footsteps,
// collisions and jump.
const R = 52;            // px, joystick throw
const LEFT = 0.4;        // fraction of the width that spawns the joystick

const CSS = `
html.touch, html.touch body { touch-action: none; overscroll-behavior: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
html.touch canvas { touch-action: none; }
#touch { position: fixed; inset: 0; z-index: 5; pointer-events: none; opacity: 0; transition: opacity 0.6s ease; -webkit-tap-highlight-color: transparent; }
#touch.on { opacity: 1; }
#touch .ring { position: absolute; border-radius: 50%; box-sizing: border-box; border: 1px solid rgba(255, 250, 242, 0.34);
  box-shadow: 0 0 0 0.5px rgba(40, 24, 16, 0.08), inset 0 0 0 0.5px rgba(40, 24, 16, 0.06); }
#touch .stick { width: ${R * 2 + 24}px; height: ${R * 2 + 24}px; margin: ${-(R + 12)}px 0 0 ${-(R + 12)}px; left: 0; top: 0;
  opacity: 0; transition: opacity 0.25s ease; }
#touch .stick.show { opacity: 1; transition-duration: 0.08s; }
#touch .stick::after { content: ''; position: absolute; left: 50%; top: 50%; width: 3px; height: 3px; margin: -1.5px;
  border-radius: 50%; background: rgba(255, 250, 242, 0.3); }
#touch .knob { width: 42px; height: 42px; margin: -21px 0 0 -21px; left: 0; top: 0; opacity: 0; transition: opacity 0.25s ease;
  background: rgba(255, 250, 242, 0.1); border-color: rgba(255, 250, 242, 0.45); }
#touch .knob.show { opacity: 1; transition-duration: 0.08s; }
#touch .hint { left: calc(env(safe-area-inset-left, 0px) + 13vw); bottom: calc(env(safe-area-inset-bottom, 0px) + 11vh);
  width: 88px; height: 88px; margin: 0 0 -44px -44px; border-style: dashed; border-color: rgba(255, 250, 242, 0.22); transition: opacity 1.2s ease; }
#touch .hint.gone { opacity: 0; }
#touch button { position: absolute; pointer-events: auto; padding: 0; margin: 0; background: rgba(255, 250, 242, 0.04); color: rgba(255, 250, 242, 0.62);
  border-radius: 50%; border: 1px solid rgba(255, 250, 242, 0.32); display: grid; place-items: center; outline: none;
  -webkit-tap-highlight-color: transparent; touch-action: none; transition: background 0.15s ease, transform 0.15s ease; }
#touch button.down { background: rgba(255, 250, 242, 0.16); transform: scale(0.94); }
#touch button svg { display: block; fill: none; stroke: currentColor; stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; }
#touch .jump { width: 64px; height: 64px; right: calc(env(safe-area-inset-right, 0px) + 26px); bottom: calc(env(safe-area-inset-bottom, 0px) + 30px); }
#touch .jump span { position: absolute; top: 100%; margin-top: 7px; left: 50%; transform: translateX(-50%); font: 400 8.5px/1 system-ui, -apple-system, sans-serif;
  letter-spacing: 0.3em; padding-left: 0.3em; text-transform: uppercase; color: rgba(255, 250, 242, 0.42); text-shadow: 0 1px 6px rgba(30, 18, 12, 0.35); }
#touch .ride { width: 56px; height: 56px; right: calc(env(safe-area-inset-right, 0px) + 30px); bottom: calc(env(safe-area-inset-bottom, 0px) + 196px);
  opacity: 0; visibility: hidden; transition: opacity 0.3s ease, visibility 0s linear 0.3s, background 0.15s ease, transform 0.15s ease;
  font: 500 9px/1 system-ui, -apple-system, sans-serif; letter-spacing: 0.22em; padding-left: 0.22em; text-transform: uppercase; }
#touch .ride.show { opacity: 1; visibility: visible; transition: opacity 0.3s ease, visibility 0s, background 0.15s ease, transform 0.15s ease; }
#touch .mute { width: 36px; height: 36px; right: calc(env(safe-area-inset-right, 0px) + 40px); bottom: calc(env(safe-area-inset-bottom, 0px) + 128px); }
#touch .mute .x { display: none; }
#touch .mute.muted .x { display: inline; }
#touch .mute.muted .w { display: none; }
@media (max-height: 420px) {
  #touch .jump { bottom: calc(env(safe-area-inset-bottom, 0px) + 22px); }
  #touch .mute { bottom: calc(env(safe-area-inset-bottom, 0px) + 22px); right: calc(env(safe-area-inset-right, 0px) + 108px); }
  #touch .ride { bottom: calc(env(safe-area-inset-bottom, 0px) + 104px); }
}
`;

const HTML = `
  <div class="ring hint"></div>
  <div class="ring stick"></div>
  <div class="ring knob"></div>
  <button class="jump" type="button" aria-label="Jump">
    <svg width="22" height="22" viewBox="0 0 22 22"><path d="M6 13.5 L11 8.5 L16 13.5" /></svg><span>Jump</span>
  </button>
  <button class="ride" type="button" aria-label="Ride">Ride</button>
  <button class="mute" type="button" aria-label="Mute">
    <svg width="18" height="18" viewBox="0 0 18 18"><path d="M3 7 H5.5 L9 4 V14 L5.5 11 H3 Z" />
      <path class="w" d="M11.5 6.5 Q13 9 11.5 11.5 M13.5 5 Q16 9 13.5 13" /><path class="x" d="M12 7 L16 11 M16 7 L12 11" /></svg>
  </button>`;

export function createTouchControls(walker, { audio, onRide } = {}) {
  document.documentElement.classList.add('touch');
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = HTML;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const stickEl = $('.stick'), knobEl = $('.knob'), hintEl = $('.hint');
  const jumpBtn = $('.jump'), muteBtn = $('.mute'), rideBtn = $('.ride'), jumpLabel = $('.jump span');

  const stick = { x: 0, y: 0 };
  walker.stick = stick;
  let move = null;   // { id, x0, y0 }
  let look = null;   // { id, x, y }
  let enabled = false;

  const place = (el, x, y) => { el.style.transform = `translate3d(${x}px, ${y}px, 0)`; };
  function releaseMove() {
    move = null; stick.x = stick.y = 0;
    stickEl.classList.remove('show'); knobEl.classList.remove('show');
  }
  function releaseAll() { releaseMove(); look = null; }

  function onStart(e) {
    if (!enabled) return;
    if (e.target.closest?.('#touch button, #overlay, #loader')) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (!move && t.clientX < innerWidth * LEFT) {
        move = { id: t.identifier, x0: t.clientX, y0: t.clientY };
        place(stickEl, t.clientX, t.clientY); place(knobEl, t.clientX, t.clientY);
        stickEl.classList.add('show'); knobEl.classList.add('show');
        hintEl.classList.add('gone');
      } else if (!look) {
        look = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    }
  }
  function onMove(e) {
    if (!enabled) return;
    if (move || look) e.preventDefault();
    // a full drag across the long side of the screen turns ~180 degrees
    const k = 3.2 / Math.max(innerWidth, innerHeight, 1);
    for (const t of e.changedTouches) {
      if (move && t.identifier === move.id) {
        let dx = t.clientX - move.x0, dy = t.clientY - move.y0;
        const d = Math.hypot(dx, dy);
        // past the rim the base follows the thumb, so reversing direction is immediate
        if (d > R * 1.35) {
          const s = (d - R * 1.35) / d;
          move.x0 += dx * s; move.y0 += dy * s;
          place(stickEl, move.x0, move.y0);
          dx = t.clientX - move.x0; dy = t.clientY - move.y0;
        }
        const m = Math.min(1, Math.hypot(dx, dy) / R), a = Math.atan2(dy, dx);
        stick.x = Math.cos(a) * m; stick.y = -Math.sin(a) * m;
        place(knobEl, move.x0 + Math.cos(a) * m * R, move.y0 + Math.sin(a) * m * R);
      } else if (look && t.identifier === look.id) {
        walker.look((t.clientX - look.x) * k, (t.clientY - look.y) * k * 0.85);
        look.x = t.clientX; look.y = t.clientY;
      }
    }
  }
  function onEnd(e) {
    for (const t of e.changedTouches) {
      if (move && t.identifier === move.id) releaseMove();
      if (look && t.identifier === look.id) look = null;
    }
  }
  const opt = { passive: false };
  document.addEventListener('touchstart', onStart, opt);
  document.addEventListener('touchmove', onMove, opt);
  document.addEventListener('touchend', onEnd, opt);
  document.addEventListener('touchcancel', onEnd, opt);
  // iOS Safari: no pinch zoom / double-tap zoom on the scene
  for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), opt);
  addEventListener('resize', releaseAll);
  addEventListener('orientationchange', releaseAll);
  addEventListener('blur', releaseAll);

  const press = (btn, fn) => {
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); btn.classList.add('down'); fn(); }, opt);
    const up = (e) => { e.preventDefault(); btn.classList.remove('down'); };
    btn.addEventListener('touchend', up, opt);
    btn.addEventListener('touchcancel', up, opt);
    btn.addEventListener('click', (e) => { e.preventDefault(); fn(); });   // mouse / accessibility
  };
  press(jumpBtn, () => walker.jump());
  press(rideBtn, () => onRide?.());
  const syncMute = () => {
    const m = !!audio?.muted;
    muteBtn.classList.toggle('muted', m);
    muteBtn.setAttribute('aria-label', m ? 'Unmute' : 'Mute');
  };
  press(muteBtn, () => { audio?.setMuted(!audio.muted); syncMute(); });
  syncMute();

  return {
    stick,
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = !!on;
      root.classList.toggle('on', enabled);
      if (!enabled) releaseAll();
    },
    syncMute,
    // mode: 'ride' (a vehicle in reach), 'off' (riding), null; kind: the ridden vehicle
    setRide(mode, kind) {
      rideBtn.classList.toggle('show', !!mode);
      rideBtn.textContent = mode === 'off' ? 'Off' : 'Ride';
      rideBtn.setAttribute('aria-label', mode === 'off' ? 'Get off' : 'Ride');
      const riding = mode === 'off';
      jumpLabel.textContent = riding ? (kind === 'atv' ? 'Boost' : 'Hop') : 'Jump';
      jumpBtn.setAttribute('aria-label', jumpLabel.textContent);
    },
  };
}
