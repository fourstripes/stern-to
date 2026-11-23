// Shared timing and rendering budgets. These are independent of the browser and GPU.
export const FIXED_STEP = 1 / 60;
export const MAX_STEPS = 6;
export const MAX_FRAME_TIME = FIXED_STEP * MAX_STEPS;

export function planSimulationSteps(accumulator, elapsed) {
  const carry = Number.isFinite(accumulator) ? Math.max(0, accumulator) : 0;
  const delta = Number.isFinite(elapsed) ? Math.min(MAX_FRAME_TIME, Math.max(0, elapsed)) : 0;
  const total = Math.min(carry + delta, MAX_FRAME_TIME);
  const count = Math.min(MAX_STEPS, Math.floor((total + 1e-10) / FIXED_STEP));
  return { count, remainder: Math.max(0, total - count * FIXED_STEP) };
}

export function renderPixelRatio(width, height, deviceRatio = 1, quality = 1, maxPixels = 4_200_000) {
  const area = Math.max(1, width) * Math.max(1, height);
  const ratio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  return Math.min(Math.min(ratio, 2) * quality, Math.sqrt(maxPixels / area));
}

// Use time, not a number of frames, so 60 Hz and 120 Hz displays react consistently.
// Sustained slow frames lower quality quickly; recovery is deliberately gradual.
export class AdaptiveQuality {
  constructor() {
    this.scale = 1;
    this.low = false;
    this.resetTiming();
  }

  resetTiming() {
    this.average = FIXED_STEP;
    this.slowTime = 0;
    this.fastTime = 0;
  }

  sample(elapsed) {
    if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 0.25) return false;
    this.average += (elapsed - this.average) * (1 - Math.exp(-elapsed / 0.75));
    this.slowTime = this.average > 1 / 43 ? this.slowTime + elapsed : 0;
    this.fastTime = this.average < 1 / 56 ? this.fastTime + elapsed : 0;
    if (this.slowTime >= 1.5) {
      this.slowTime = 0;
      this.fastTime = 0;
      if (!this.low) { this.low = true; return true; }
      const next = Math.max(0.7, this.scale * 0.85);
      if (next !== this.scale) { this.scale = next; return true; }
    }
    if (this.fastTime >= 6) {
      this.fastTime = 0;
      if (this.scale < 1) { this.scale = Math.min(1, this.scale + 0.05); return true; }
      if (this.low) { this.low = false; return true; }
    }
    return false;
  }
}
