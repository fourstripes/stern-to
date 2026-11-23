import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as THREE from 'three';
import * as runtime from '../../src/runtime.js';
import * as physics from '../../src/physics.js';
import * as navigation from '../../src/navigation.js';
import * as water from '../../src/water.js';

// This is a JavaScript/DOM integration harness, not a browser or a GPU renderer.
// All game code and Three.js geometry/material/matrix classes execute unchanged.
// Layout measurements, the clock, 2D drawing and the WebGL submission boundary are fake.
export function createGameHarness(options = {}) {
  const width = options.width ?? 1280, height = options.height ?? 800;
  const errors = [], warnings = [], fetchCalls = [], lifecycleEvents = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(readFileSync(new URL('../../index.html', import.meta.url), 'utf8'), {
    url: options.url ?? 'http://localhost:8080/stern-to/',
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole
  });
  const { window } = dom, { document } = window;
  const frames = new Map(), timers = new Map(), rectangles = new WeakMap(), captures = new WeakMap();
  let now = 0, nextHandle = 1, visibility = 'visible', closed = false, readyCount = 0;
  Object.defineProperties(window, {
    innerWidth: { configurable: true, value: width },
    innerHeight: { configurable: true, value: height },
    devicePixelRatio: { configurable: true, value: options.pixelRatio ?? 1 }
  });
  Object.defineProperties(document, {
    hidden: { configurable: true, get: () => visibility !== 'visible' },
    visibilityState: { configurable: true, get: () => visibility }
  });
  Object.defineProperty(window.performance, 'now', { configurable: true, value: () => now });
  window.requestAnimationFrame = callback => { const id = nextHandle++; frames.set(id, callback); return id; };
  window.cancelAnimationFrame = id => frames.delete(id);
  window.setTimeout = (callback, delay = 0, ...args) => {
    const id = nextHandle++; timers.set(id, { at: now + Math.max(0, Number(delay) || 0), callback, args }); return id;
  };
  window.clearTimeout = id => timers.delete(id);
  window.console = { ...console, warn: (...args) => warnings.push(args), error: (...args) => errors.push(args) };
  let randomSeed = options.seed ?? 17;
  window.Math.random = () => ((randomSeed = (randomSeed * 16807) % 2147483647) - 1) / 2147483646;
  window.fetch = async (...args) => {
    fetchCalls.push(args);
    return options.fetch ? options.fetch(...args) : { ok: true, json: async () => ({ value: 0 }) };
  };
  window.matchMedia = query => {
    let matches = true;
    if (query.includes('prefers-reduced-motion')) matches &&= !!options.reducedMotion;
    if (query.includes('pointer:coarse') || query.includes('pointer: coarse')) matches &&= !!options.coarse;
    if (query.includes('orientation:landscape')) matches &&= width > height;
    for (const [, kind, size] of query.matchAll(/(max|min)-width:\s*(\d+)px/g)) matches &&= kind === 'max' ? width <= +size : width >= +size;
    for (const [, kind, size] of query.matchAll(/(max|min)-height:\s*(\d+)px/g)) matches &&= kind === 'max' ? height <= +size : height >= +size;
    return { media: query, matches, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  };
  const observers = new Set();
  window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.add(this); }
    observe() {}
    unobserve() {}
    disconnect() { observers.delete(this); }
  };
  if (!('inert' in window.HTMLElement.prototype)) Object.defineProperty(window.HTMLElement.prototype, 'inert', {
    configurable: true, get() { return this.hasAttribute('inert'); },
    set(value) { this.toggleAttribute('inert', !!value); }
  });
  const box = (x, y, w, h) => ({ x, y, width: w, height: h, top: y, left: x, right: x + w, bottom: y + h, toJSON() { return { x, y, width: w, height: h }; } });
  function rect(element) {
    if (element.closest?.('[hidden]')) return box(0, 0, 0, 0);
    if (rectangles.has(element)) return rectangles.get(element);
    if (element.id === 'app' || element === document.body || element === document.documentElement) return box(0, 0, width, height);
    if (element.classList?.contains('hud')) return box(0, 0, width, 31);
    if (element.id === 'gl') return box(0, 31, width, height - 31);
    if (element.id === 'dock') return box(Math.max(0, (width - 460) / 2), height - 190, Math.min(width, 460), 180);
    if (element.classList?.contains('track')) return box(element.closest('#lvP') ? width / 2 - 205 : width / 2 + 165, height - 160, 40, 110);
    if (element.id === 'rud' || element.classList?.contains('rud')) return box(width / 2 - 125, height - 100, 250, 40);
    return box(10, 10, 100, 40);
  }
  window.Element.prototype.getBoundingClientRect = function () { return rect(this); };
  window.Element.prototype.getClientRects = function () { const r = rect(this); return r.width && r.height ? [r] : []; };
  for (const [property, dimension] of [['clientWidth', 'width'], ['clientHeight', 'height'], ['offsetWidth', 'width'], ['offsetHeight', 'height']]) {
    Object.defineProperty(window.HTMLElement.prototype, property, { configurable: true, get() { return rect(this)[dimension]; } });
  }
  window.Element.prototype.setPointerCapture = function (id) {
    if (!captures.has(this)) captures.set(this, new Set()); captures.get(this).add(id);
  };
  window.Element.prototype.hasPointerCapture = function (id) { return captures.get(this)?.has(id) ?? false; };
  window.Element.prototype.releasePointerCapture = function (id) {
    if (!captures.get(this)?.delete(id)) return;
    const event = new window.Event('lostpointercapture', { bubbles: true });
    Object.defineProperty(event, 'pointerId', { value: id }); this.dispatchEvent(event);
  };
  const gradient = () => ({ addColorStop() {} });
  const drawingContext = () => new Proxy({ createRadialGradient: gradient, createLinearGradient: gradient, measureText: text => ({ width: String(text).length * 7 }) }, {
    get(target, key) { return key in target ? target[key] : () => {}; }
  });
  window.HTMLCanvasElement.prototype.getContext = function (kind) { return kind === '2d' ? drawingContext() : null; };

  let renderer;
  class FakeRenderer {
    constructor({ canvas }) {
      renderer = this; this.domElement = canvas; this.target = null; this.ratio = 1;
      this.clearColor = new THREE.Color(); this.clearAlpha = 0; this.contextLost = false;
      this.geometries = new Set(); this.materials = new Set(); this.textures = new Set(); this.instances = new Set();
      this.disposals = { geometries: 0, materials: 0, textures: 0, instances: 0 };
      this.shaderIncludes = new Set();
      this.renderCalls = 0; this.foamPasses = 0; this.clearCalls = 0; this.resizeCalls = 0;
      this.info = { memory: { geometries: 0, textures: 0 }, render: { calls: 0 }, programs: [] };
      this.context = { isContextLost: () => this.contextLost };
    }
    getContext() { return this.context; }
    getRenderTarget() { return this.target; }
    setRenderTarget(target) { this.target = target; }
    getClearColor(target) { return target.copy(this.clearColor); }
    getClearAlpha() { return this.clearAlpha; }
    setClearColor(value, alpha = 1) { this.clearColor.set(value); this.clearAlpha = alpha; }
    clear() { this.clearCalls++; }
    setPixelRatio(ratio) { this.ratio = ratio; }
    getPixelRatio() { return this.ratio; }
    setSize(w, h) { this.resizeCalls++; this.domElement.width = Math.floor(w * this.ratio); this.domElement.height = Math.floor(h * this.ratio); }
    getDrawingBufferSize(target) { return target.set(this.domElement.width, this.domElement.height); }
    track(kind, resource) {
      const set = this[kind];
      if (!resource || set.has(resource)) return;
      set.add(resource);
      const onDispose = () => {
        set.delete(resource); this.disposals[kind]++; resource.removeEventListener('dispose', onDispose);
        this.info.memory.geometries = this.geometries.size; this.info.memory.textures = this.textures.size;
      };
      resource.addEventListener('dispose', onDispose);
    }
    render(scene, camera) {
      if (this.contextLost) throw new Error('Game rendered while graphics context was lost');
      this.renderCalls++; if (this.target) this.foamPasses++;
      scene.updateMatrixWorld(); camera.updateMatrixWorld();
      scene.traverse(object => {
        this.track('geometries', object.geometry);
        if (object.isInstancedMesh) this.track('instances', object);
        for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
          if (!this.materials.has(material) && material.isShaderMaterial) {
            for (const shader of [material.vertexShader, material.fragmentShader]) {
              for (const [, chunk] of shader.matchAll(/#include\s+<([^>]+)>/g)) {
                if (!(chunk in THREE.ShaderChunk)) throw new Error(`Unknown Three.js r${THREE.REVISION} shader include: ${chunk}`);
                this.shaderIncludes.add(chunk);
              }
            }
          }
          this.track('materials', material);
          for (const value of Object.values(material)) if (value?.isTexture) this.track('textures', value);
          for (const uniform of Object.values(material.uniforms ?? {})) if (uniform.value?.isTexture) this.track('textures', uniform.value);
        }
      });
      this.info.memory.geometries = this.geometries.size; this.info.memory.textures = this.textures.size;
      this.info.render.calls = this.renderCalls;
    }
  }

  Object.assign(window, runtime, physics, navigation, water, { T3: { ...THREE, WebGLRenderer: FakeRenderer } });
  const source = readFileSync(new URL('../../src/game.js', import.meta.url), 'utf8')
    .replace(/^import\s[^;]+;\s*$/gm, '').replace('export function startGame', 'function startGame');
  const lastBrace = source.lastIndexOf('}');
  if (lastBrace < 0) throw new Error('startGame test hook insertion point missing');
  const instrumented = '"use strict";\n' + source.slice(0, lastBrace) + '\nreturn { run: code => eval(code) };\n' + source.slice(lastBrace);
  vm.runInContext(instrumented, dom.getInternalVMContext(), { filename: 'src/game.js' });
  let inspector;
  try {
    inspector = window.startGame({
      onReady() {
        readyCount++; lifecycleEvents.push('ready');
        document.getElementById('startup').hidden = true;
        document.getElementById('app').inert = false;
        document.getElementById('app').setAttribute('aria-busy', 'false');
      },
      onError(error) { errors.push(error); lifecycleEvents.push('error'); },
      onContextLost() { lifecycleEvents.push('context-lost'); },
      onContextRestored() { lifecycleEvents.push('context-restored'); }
    });
  } catch (error) { dom.window.close(); throw error; }
  const element = value => typeof value === 'string' ? document.getElementById(value) ?? document.querySelector(value) : value;
  function runTimers() {
    for (let turn = 0; turn < 1000; turn++) {
      const due = [...timers].filter(([, item]) => item.at <= now);
      if (!due.length) return;
      for (const [id, item] of due) { timers.delete(id); item.callback(...item.args); }
    }
    throw new Error('Test timers failed to settle');
  }
  const harness = {
    window, document, renderer, errors, warnings, fetchCalls, lifecycleEvents, element,
    get readyCount() { return readyCount; },
    get now() { return now; },
    get pendingFrames() { return frames.size; },
    run: code => inspector.run(code),
    read: code => JSON.parse(inspector.run(`JSON.stringify(${code})`)),
    frame(ms = 1000 / 60) {
      if (closed) throw new Error('Game harness is closed');
      now += ms; runTimers();
      const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback(now);
      runTimers(); return pending.length;
    },
    advance(ms, frameMs = 1000 / 60) {
      const end = now + ms;
      while (now < end - 1e-8) harness.frame(Math.min(frameMs, end - now));
    },
    async flush() { for (let i = 0; i < 5; i++) await Promise.resolve(); },
    click(id) { element(id).click(); },
    key(type, key, { target = document.activeElement, ...init } = {}) {
      const event = new window.KeyboardEvent(type, { bubbles: true, cancelable: true, key, ...init });
      element(target).dispatchEvent(event); return event;
    },
    pointer(id, type, { pointerId = 1, pointerType = 'touch', ...init } = {}) {
      const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
      Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: pointerType } });
      element(id).dispatchEvent(event); return event;
    },
    setVisibility(value) { visibility = value; document.dispatchEvent(new window.Event('visibilitychange')); },
    setRect(id, r) { rectangles.set(element(id), box(r.x ?? r.left ?? 0, r.y ?? r.top ?? 0, r.width, r.height)); },
    resize() { for (const observer of observers) observer.callback([]); window.dispatchEvent(new window.Event('resize')); },
    loseContext() {
      renderer.contextLost = true;
      const event = new window.Event('webglcontextlost', { cancelable: true }); element('gl').dispatchEvent(event); return event;
    },
    restoreContext() { renderer.contextLost = false; element('gl').dispatchEvent(new window.Event('webglcontextrestored')); },
    close() { closed = true; frames.clear(); timers.clear(); observers.clear(); window.close(); }
  };
  if (options.autoFrame !== false) harness.frame();
  return harness;
}
