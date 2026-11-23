// Analytic water shared by the renderer and CPU queries. Distances are metres,
// time is seconds, and directions use the game's world X/Z plane.
const TAU = Math.PI * 2;
const GRAVITY = 9.81;
const WAVE_COUNT = 6;
const MAX_STEEPNESS = .6;
const KING_SLOPE = Math.SQRT2 * Math.exp(-.5) / 11;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

export function buildWaves(env, out = []) {
  const wind = (finite(env.wFrom, 270) + 180) * Math.PI / 180;
  const swell = (finite(env.sFrom, 180) + 180) * Math.PI / 180;
  const strength = clamp(finite(env.wk, 0) / 22, 0, 1.4);
  const height = Math.max(0, finite(env.sh, 0));
  // A specified period and wavelength are related by deep-water dispersion.
  // Preserve the configured wavelength; derive the period from it for every wave.
  const spectrum = [
    [swell, Math.max(4, finite(env.lam, 48)), height * .5],
    [swell + .4, 31, height * .15],
    [wind + .15, 16, .16 * strength],
    [wind - .4, 10, .11 * strength],
    [wind + .55, 6.5, .07 * strength],
    [wind - .15, 4.2, .045 * strength]
  ];
  let steepness = 0;
  for (let i = 0; i < WAVE_COUNT; i++) {
    const [direction, length, amp] = spectrum[i];
    const wave = out[i] ?? (out[i] = {});
    wave.dx = Math.sin(direction); wave.dz = -Math.cos(direction);
    wave.k = TAU / length; wave.amp = amp; wave.om = Math.sqrt(GRAVITY * wave.k);
    steepness += amp * wave.k;
  }
  out.length = WAVE_COUNT;
  // Bound the horizontal Jacobian even when a scripted storm raises amplitude.
  // The remaining margin accommodates the shelter gradient and the large set.
  out.chop = Math.min(.7, MAX_STEEPNESS / Math.max(steepness, 1e-9));
  return out;
}

// Evaluate a Lagrangian parameter point, including analytic surface derivatives.
// Reuse `out` for frequent calls. The shelter function is independent of camera
// position so a camera move cannot change the water supporting a vessel.
export function evaluateWater(waves, settings, x, z, time, out = {}) {
  const scale = Math.max(.25, finite(settings.scale, 1));
  const sx = x - settings.shelterX, sz = z - settings.shelterZ;
  const distance = Math.hypot(sx, sz);
  const q = clamp((distance - 45 * scale) / (165 * scale), 0, 1);
  const shelter = .22 + .78 * q * q * (3 - 2 * q);
  const rate = q > 0 && q < 1 && distance > 0 ? .78 * 6 * q * (1 - q) / (165 * scale * distance) : 0;
  const shelterX = rate * sx, shelterZ = rate * sz, chop = waves.chop;
  let px = x, pz = z, height = 0, jxx = 1, jxz = 0, jzx = 0, jzz = 1, dyx = 0, dyz = 0;
  let vx = 0, vz = 0, vy = 0;
  for (const wave of waves) {
    const phase = wave.k * (wave.dx * x + wave.dz * z) - wave.om * time;
    const sin = Math.sin(phase), cos = Math.cos(phase), amp = wave.amp * shelter;
    const ax = wave.amp * shelterX, az = wave.amp * shelterZ;
    const dx = ax * cos - amp * wave.k * wave.dx * sin;
    const dz = az * cos - amp * wave.k * wave.dz * sin;
    px += chop * wave.dx * amp * cos; pz += chop * wave.dz * amp * cos; height += amp * sin;
    jxx += chop * wave.dx * dx; jxz += chop * wave.dx * dz;
    jzx += chop * wave.dz * dx; jzz += chop * wave.dz * dz;
    dyx += ax * sin + amp * wave.k * wave.dx * cos;
    dyz += az * sin + amp * wave.k * wave.dz * cos;
    vx += chop * wave.dx * amp * wave.om * sin;
    vz += chop * wave.dz * amp * wave.om * sin; vy -= amp * wave.om * cos;
  }
  const king = settings.king;
  if (king?.on && king.A > 0) {
    const dx = king.d[0], dz = king.d[1], along = x * dx + z * dz - king.pos;
    const width = along > 0 ? 11 : 24;
    const h = king.A * Math.exp(-along * along / (width * width));
    const slope = h * -2 * along / (width * width);
    const kingChop = Math.min(.35, .15 / (king.A * KING_SLOPE));
    px += dx * h * kingChop; pz += dz * h * kingChop; height += h;
    jxx += dx * dx * slope * kingChop; jxz += dx * dz * slope * kingChop;
    jzx += dz * dx * slope * kingChop; jzz += dz * dz * slope * kingChop;
    dyx += dx * slope; dyz += dz * slope;
    const speed = finite(king.c, 11);
    vx -= dx * speed * slope * kingChop; vz -= dz * speed * slope * kingChop; vy -= speed * slope;
  }
  const determinant = jxx * jzz - jxz * jzx;
  const slopeX = (dyx * jzz - dyz * jzx) / determinant;
  const slopeZ = (dyz * jxx - dyx * jxz) / determinant;
  out.x = px; out.z = pz; out.height = height;
  out.jxx = jxx; out.jxz = jxz; out.jzx = jzx; out.jzz = jzz;
  out.dyx = dyx; out.dyz = dyz; out.determinant = determinant;
  out.slopeX = slopeX; out.slopeZ = slopeZ; out.velocityY = vy - slopeX * vx - slopeZ * vz;
  return out;
}

// A Gerstner surface moves horizontally: sampling its height at world X/Z
// therefore requires inversion, not just evaluating sine waves at that point.
export function sampleWater(waves, settings, x, z, time, out = {}) {
  let qx = x, qz = z;
  for (let i = 0; i < 5; i++) {
    evaluateWater(waves, settings, qx, qz, time, out);
    const ex = out.x - x, ez = out.z - z;
    if (Math.abs(ex) + Math.abs(ez) < 1e-7) return out;
    qx -= (out.jzz * ex - out.jxz * ez) / out.determinant;
    qz -= (out.jxx * ez - out.jzx * ex) / out.determinant;
  }
  evaluateWater(waves, settings, qx, qz, time, out);
  return out;
}

// Exact damped-spring step for a target held over this interval. Unlike Euler
// integration, its damping and stability do not depend on the display rate.
export function stepDampedSpring(state, position, velocity, target, omega, damping, dt) {
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  let x = state[position] - target, v = state[velocity];
  if (!Number.isFinite(x + v + target + omega + damping)) { state[position] = finite(target, 0); state[velocity] = 0; return; }
  if (omega <= 0) { state[position] += v * dt; return; }
  damping = Math.max(0, damping);
  const decay = Math.exp(-damping * omega * dt);
  if (damping < 1 - 1e-5) {
    const frequency = omega * Math.sqrt(1 - damping * damping), phase = frequency * dt;
    const sin = Math.sin(phase) / frequency, cos = Math.cos(phase);
    state[position] = target + decay * (x * cos + (v + damping * omega * x) * sin);
    state[velocity] = decay * (v * cos - (damping * omega * v + omega * omega * x) * sin);
  } else if (damping <= 1 + 1e-5) {
    const b = v + omega * x;
    state[position] = target + decay * (x + b * dt);
    state[velocity] = decay * (v - omega * b * dt);
  } else {
    const d = omega * Math.sqrt(damping * damping - 1), r1 = -damping * omega + d, r2 = -damping * omega - d;
    const a = (v - r2 * x) / (r1 - r2), b = x - a, ea = a * Math.exp(r1 * dt), eb = b * Math.exp(r2 * dt);
    state[position] = target + ea + eb; state[velocity] = r1 * ea + r2 * eb;
  }
}

export function foamParameters(dt) {
  const elapsed = Math.max(0, finite(dt, 0));
  const decay = Math.pow(.5, elapsed / .3);
  return { decay, stampWeight: 1 - decay, spread: Math.min(.24, 6 * elapsed) };
}

export function waterQuality(coarse, low) {
  return {
    segments: low ? (coarse ? 192 : 256) : (coarse ? 256 : 384),
    rippleOctaves: low ? 4 : coarse ? 6 : 9,
    wakeStride: low ? 2 : 1,
    foamDetail: low ? 0 : 1,
    foamResolution: coarse ? 256 : 512
  };
}

// The same coefficients and derivatives as evaluateWater(). uT is declared by
// each consuming shader. Both vertex displacement and fragment normals use this
// function; small lighting-only ripples are added separately by the fragment shader.
export const WATER_GLSL = `
uniform vec4 uW[${WAVE_COUNT}];uniform float uOm[${WAVE_COUNT}],uChop;
uniform vec3 uSlip;uniform vec4 uKing;
vec3 waterShelter(vec2 p){
  vec2 d=p-uSlip.xy;float r=length(d),s=max(.25,uSlip.z),t=clamp((r-45.*s)/(165.*s),0.,1.);
  float a=.22+.78*t*t*(3.-2.*t),v=(t>0.&&t<1.&&r>0.)?.78*6.*t*(1.-t)/(165.*s*r):0.;
  return vec3(a,d*v);
}
void waterSurface(vec2 p,out vec3 o,out vec3 tx,out vec3 tz){
  vec3 sh=waterShelter(p);o=vec3(p.x,0.,p.y);tx=vec3(1.,0.,0.);tz=vec3(0.,0.,1.);
  for(int i=0;i<${WAVE_COUNT};i++){
    vec2 d=uW[i].xy;float k=uW[i].z,a=uW[i].w*sh.x,ph=k*dot(d,p)-uOm[i]*uT,s=sin(ph),c=cos(ph);
    vec2 da=uW[i].w*sh.yz,dd=da*c-a*k*d*s,dy=da*s+a*k*d*c;
    o.xz+=uChop*d*a*c;o.y+=a*s;
    tx+=vec3(uChop*d.x*dd.x,dy.x,uChop*d.y*dd.x);
    tz+=vec3(uChop*d.x*dd.y,dy.y,uChop*d.y*dd.y);
  }
  if(uKing.w>0.){
    float x=dot(p,uKing.xy)-uKing.z,w=x>0.?11.:24.,h=uKing.w*exp(-x*x/(w*w)),s=h*(-2.*x/(w*w));
    float q=min(.35,.15/(uKing.w*${KING_SLOPE.toPrecision(16)}));vec2 d=uKing.xy;
    o.y+=h;o.xz+=d*h*q;
    tx+=vec3(d.x*d.x*s*q,d.x*s,d.y*d.x*s*q);
    tz+=vec3(d.x*d.y*s*q,d.y*s,d.y*d.y*s*q);
  }
}
`;
