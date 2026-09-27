// Post chain: RenderPass -> bloom (sun / glitter only) -> camera grade -> OutputPass.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { sunDir } from '../sky.js';

// Operates on linear HDR scene colour, before tone mapping.
const GradeShader = {
  name: 'CameraGrade',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uShadowTint: { value: new THREE.Vector3(0.93, 0.98, 1.08) },
    uHighlightTint: { value: new THREE.Vector3(1.02, 0.995, 0.985) },
    uSaturation: { value: 0.97 },
    uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
    uSunVis: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uSaturation;
    uniform vec2 uResolution, uSunUv;
    uniform float uSunVis;
    uniform vec3 uShadowTint, uHighlightTint;
    varying vec2 vUv;

    float hash(vec3 p) {
      p = fract(p * 0.1031);
      p += dot(p, p.zyx + 31.32);
      return fract((p.x + p.y) * p.z);
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // veiling glare from an in-frame low sun: lifts and flattens everything around it
      vec2 sd = (vUv - uSunUv) * vec2(uResolution.x / uResolution.y, 1.0);
      float dsun = length(sd);
      // flattened: the glare spreads along the horizon more than up and down
      float dsE = length(sd * vec2(0.55, 1.6));
      c += vec3(1.0, 0.46, 0.1) * uSunVis * (0.05 * exp(-dsE * 9.0) + 0.045 * exp(-dsE * 3.5));
      // lens character: faint irregular rays, a soft horizontal streak, two ghosts
      // mirrored through the frame centre, and a low-contrast veil over the frame
      float ang = atan(sd.y, sd.x);
      float rays = 0.55 + 0.45 * sin(ang * 7.0 + 1.3) * sin(ang * 11.0 - 0.4);
      c += vec3(1.0, 0.62, 0.3) * uSunVis * 0.012 * rays * exp(-dsun * 6.0);
      c += vec3(1.0, 0.55, 0.25) * uSunVis * 0.035 * exp(-abs(sd.y) * 70.0) * exp(-abs(sd.x) * 2.5);
      vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
      vec2 g1 = 0.5 + (0.5 - uSunUv) * 0.55, g2 = 0.5 + (0.5 - uSunUv) * 1.25;
      c += vec3(0.55, 0.75, 0.45) * uSunVis * 0.018 * smoothstep(0.055, 0.035, length((vUv - g1) * aspect));
      c += vec3(0.9, 0.5, 0.3) * uSunVis * 0.012 * smoothstep(0.11, 0.06, length((vUv - g2) * aspect));
      c += vec3(0.007, 0.005, 0.0035) * uSunVis;
      // split tone: cool shade, warm light (one consistent sunrise balance)
      float l0 = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c *= mix(uShadowTint, uHighlightTint, smoothstep(0.015, 0.15, l0));

      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // sunlit highlights keep their colour (ACES would otherwise bleach them to pastel)
      c = max(mix(vec3(l), c, uSaturation + 0.02 * smoothstep(0.2, 1.2, l)), 0.0);
      // lift the deepest shadows very slightly toward a cool tone (film toe)
      c += vec3(0.004, 0.006, 0.010) * (1.0 - smoothstep(0.0, 0.08, l));

      gl_FragColor = vec4(c, 1.0);
    }`,
};

// Display-referred (after tone mapping + sRGB): a gentle S-curve and a subtle corner
// vignette. No grain; only a static half-step dither so the sky gradient doesn't band.
const FinishShader = {
  name: 'CameraFinish',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.12 },
    uContrast: { value: 0.4 },
  },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uContrast;
    uniform vec2 uResolution;
    varying vec2 vUv;
    float hash(vec2 p) {
      vec3 q = fract(vec3(p.xyx) * 0.1031);
      q += dot(q, q.yzx + 33.33);
      return fract((q.x + q.y) * q.z);
    }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // gentle print S-curve: deeper blacks in backlit areas, a little more mid contrast
      c = max(c - 0.012, 0.0) / 0.988;
      c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
      vec2 p = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) / 1.02;
      c *= 1.0 - uVignette * smoothstep(0.1, 1.0, dot(p, p));
      vec2 px = floor(vUv * uResolution);
      c += (hash(px) + hash(px + 71.0) - 1.0) / 255.0;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

const _fwd = new THREE.Vector3(), _sp = new THREE.Vector3();

// Quality knobs: samples = MSAA of the scene target (0 = none), bloom = add the bloom
// pass, fxaa = a final FXAA pass (cheap edge smoothing when there is no MSAA).
export function createPost(renderer, scene, camera, { bloomStrength = 0.16, samples = 4, bloom: useBloom = true, fxaa: useFxaa = false } = {}) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, rt);
  // only the scene pass needs MSAA; the ping-pong target is written by full-screen passes
  composer.renderTarget2.samples = 0;

  composer.addPass(new RenderPass(scene, camera));

  const bloom = useBloom ? new UnrealBloomPass(new THREE.Vector2(size.x, size.y), bloomStrength, 0.25, 4.0) : null;
  if (bloom) composer.addPass(bloom);

  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  composer.addPass(new OutputPass());
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);
  const fxaa = useFxaa ? new ShaderPass(FXAAShader) : null;
  if (fxaa) composer.addPass(fxaa);

  function updateUniforms() {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    grade.uniforms.uResolution.value.set(s.x, s.y);
    finish.uniforms.uResolution.value.set(s.x, s.y);
    fxaa?.uniforms.resolution.value.set(1 / s.x, 1 / s.y);
  }
  function setSize(w, h) {
    composer.setSize(w, h);
    updateUniforms();
  }
  setSize(size.x / renderer.getPixelRatio(), size.y / renderer.getPixelRatio());

  return {
    composer,
    bloom,
    grade,
    setSize,
    // call after renderer.setPixelRatio (dynamic resolution)
    setPixelRatio(r) {
      composer.setPixelRatio(r);
      updateUniforms();
    },
    render(time) {
      grade.uniforms.uTime.value = time;
      finish.uniforms.uTime.value = time;
      // sun position on screen for the veiling glare
      camera.getWorldDirection(_fwd);
      _sp.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
      const front = _fwd.dot(sunDir) > 0;
      const off = Math.max(Math.abs(_sp.x), Math.abs(_sp.y)) - 1;
      grade.uniforms.uSunVis.value = front ? THREE.MathUtils.clamp(1 - off / 0.6, 0, 1) : 0;
      grade.uniforms.uSunUv.value.set(_sp.x * 0.5 + 0.5, _sp.y * 0.5 + 0.5);
      composer.render();
    },
  };
}
