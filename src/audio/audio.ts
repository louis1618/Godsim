/**
 * Fully procedural audio: every sound is synthesised at runtime with WebAudio (no samples).
 * - spatial one-shots for powers and world events (distance + stereo from the camera)
 * - ambience beds that crossfade with zoom: high wind in orbit, surf/birds/village life up close
 * - a generative score that shifts to minor + drums when the world is at war
 */
type Vec = { x: number; z: number };

const PENT = [0, 2, 4, 7, 9];
const MINOR = [0, 2, 3, 7, 8];
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private mus!: GainNode;
  private verb!: ConvolverNode;
  private verbSend!: GainNode;
  private noise!: AudioBuffer;
  vol = { master: 0.8, music: 0.55, sfx: 0.8, amb: 0.7 };
  listener = { x: 0, z: 0, span: 60, z01: 1, yaw: 0 };
  private ambNodes: Record<string, { g: GainNode; src?: AudioNode }> = {};
  private nextNote = 0;
  private step = 0;
  private chord = 0;
  mood = 0; // 0 peaceful .. 1 war
  private lastPlay = new Map<string, number>();
  private started = false;

  /** Must be called from a user gesture. */
  start() {
    if (this.started) { this.ctx?.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.started = true;
    this.master = c.createGain(); this.master.gain.value = this.vol.master;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = this.vol.sfx; this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = this.vol.amb; this.amb.connect(this.master);
    this.mus = c.createGain(); this.mus.gain.value = this.vol.music; this.mus.connect(this.master);
    // white noise
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // generated reverb impulse
    this.verb = c.createConvolver();
    const len = c.sampleRate * 2.6;
    const imp = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const a = imp.getChannelData(ch); for (let i = 0; i < len; i++) a[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.verb.buffer = imp;
    this.verbSend = c.createGain(); this.verbSend.gain.value = 0.35;
    this.verbSend.connect(this.verb).connect(this.master);
    this.initAmbience();
    this.nextNote = c.currentTime + 0.5;
  }

  setVolume(k: keyof AudioEngine['vol'], v: number) {
    this.vol[k] = v;
    if (!this.ctx) return;
    const node = k === 'master' ? this.master : k === 'music' ? this.mus : k === 'sfx' ? this.sfx : this.amb;
    node.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // ------------------------------------------------------------- primitives
  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  private tone(freq: number, opts: { type?: OscillatorType; a?: number; d?: number; g?: number; to?: number; glide?: number; dest?: AudioNode; t?: number; detune?: number; verb?: number; pan?: number } = {}) {
    const c = this.ctx!; const t = opts.t ?? c.currentTime;
    const o = c.createOscillator(); o.type = opts.type ?? 'sine'; o.frequency.setValueAtTime(freq, t);
    if (opts.detune) o.detune.value = opts.detune;
    if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + (opts.glide ?? (opts.d ?? 0.2)));
    const g = c.createGain();
    this.env(g, t, opts.a ?? 0.005, opts.g ?? 0.2, opts.d ?? 0.2);
    let out: AudioNode = g;
    if (opts.pan) { const p = c.createStereoPanner(); p.pan.value = opts.pan; g.connect(p); out = p; }
    o.connect(g);
    out.connect(opts.dest ?? this.sfx);
    if (opts.verb) { const s = c.createGain(); s.gain.value = opts.verb; out.connect(s).connect(this.verbSend); }
    o.start(t); o.stop(t + (opts.a ?? 0.005) + (opts.d ?? 0.2) + 0.05);
  }
  private burst(opts: { type?: BiquadFilterType; f?: number; to?: number; q?: number; a?: number; d?: number; g?: number; dest?: AudioNode; t?: number; verb?: number; pan?: number; rate?: number }) {
    const c = this.ctx!; const t = opts.t ?? c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = opts.rate ?? 1;
    const f = c.createBiquadFilter(); f.type = opts.type ?? 'lowpass'; f.frequency.setValueAtTime(opts.f ?? 1000, t); f.Q.value = opts.q ?? 0.8;
    if (opts.to) f.frequency.exponentialRampToValueAtTime(Math.max(30, opts.to), t + (opts.a ?? 0.005) + (opts.d ?? 0.3));
    const g = c.createGain();
    this.env(g, t, opts.a ?? 0.005, opts.g ?? 0.3, opts.d ?? 0.3);
    s.connect(f).connect(g);
    let out: AudioNode = g;
    if (opts.pan) { const p = c.createStereoPanner(); p.pan.value = opts.pan; g.connect(p); out = p; }
    out.connect(opts.dest ?? this.sfx);
    if (opts.verb) { const v = c.createGain(); v.gain.value = opts.verb; out.connect(v).connect(this.verbSend); }
    s.start(t, Math.random() * 1.5); s.stop(t + (opts.a ?? 0.005) + (opts.d ?? 0.3) + 0.05);
  }

  // ------------------------------------------------------------- UI
  ui(name: string) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'hover': this.tone(1500, { type: 'sine', d: 0.04, g: 0.03 }); break;
      case 'click': this.tone(700, { type: 'triangle', d: 0.06, g: 0.12, to: 500 }); break;
      case 'select': this.tone(660, { type: 'triangle', d: 0.08, g: 0.12 }); this.tone(990, { type: 'sine', d: 0.12, g: 0.08, t: t + 0.05 }); break;
      case 'tab': this.tone(520, { type: 'square', d: 0.05, g: 0.04 }); this.tone(780, { type: 'triangle', d: 0.1, g: 0.1, t: t + 0.04 }); break;
      case 'open': this.tone(440, { type: 'triangle', d: 0.1, g: 0.1, to: 880, glide: 0.1 }); break;
      case 'close': this.tone(880, { type: 'triangle', d: 0.1, g: 0.08, to: 440, glide: 0.1 }); break;
      case 'pop': this.tone(900, { type: 'sine', d: 0.07, g: 0.14, to: 1400, glide: 0.04 }); break;
      case 'deny': this.tone(220, { type: 'square', d: 0.12, g: 0.06 }); this.tone(180, { type: 'square', d: 0.15, g: 0.05, t: t + 0.08 }); break;
      case 'whoosh': this.burst({ type: 'bandpass', f: 400, to: 2400, q: 1.5, a: 0.15, d: 0.5, g: 0.18 }); break;
      case 'create': [0, 4, 7, 12, 16].forEach((n, i) => this.tone(mtof(60 + n), { type: 'triangle', d: 0.9, g: 0.13, t: t + i * 0.09, verb: 0.6 })); break;
      case 'start': [0, 7, 12, 19, 24].forEach((n, i) => this.tone(mtof(55 + n), { type: 'sine', a: 0.02, d: 1.6, g: 0.12, t: t + i * 0.12, verb: 0.8 })); break;
    }
  }

  // ------------------------------------------------------------- spatial one-shots
  private spatial(x: number, z: number): { g: number; pan: number } {
    const L = this.listener;
    const dx = x - L.x, dz = z - L.z;
    const d = Math.hypot(dx, dz);
    const g = Math.max(0, 1 - d / (L.span * 1.4));
    const c = Math.cos(L.yaw), s = Math.sin(L.yaw);
    const sx = dx * c - dz * s;
    return { g: g * g, pan: Math.max(-0.8, Math.min(0.8, sx / (L.span * 0.6))) };
  }

  private rate(key: string, ms: number) {
    const now = performance.now();
    if ((this.lastPlay.get(key) ?? 0) + ms > now) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  play(id: string, x: number, z: number, ok = true) {
    if (!this.ctx || !ok) return;
    const { g, pan } = this.spatial(x, z);
    const big = Math.max(0.35, g);
    const t = this.ctx.currentTime;
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    switch (id) {
      // terrain brushes: earthy rumble / splash / crunch
      case 'raise': case 'mountain': if (this.rate(id, 90)) this.burst({ f: r(250, 400), to: 120, a: 0.02, d: 0.25, g: 0.18 * big, pan }); break;
      case 'lower': case 'flatten': if (this.rate(id, 90)) this.burst({ f: 300, to: 90, a: 0.02, d: 0.22, g: 0.16 * big, pan }); break;
      case 'ocean': if (this.rate(id, 110)) { this.burst({ type: 'bandpass', f: r(600, 900), to: 300, q: 2, a: 0.02, d: 0.3, g: 0.18 * big, pan }); this.tone(r(300, 500), { type: 'sine', to: r(700, 900), d: 0.08, g: 0.05 * big, pan }); } break;
      case 'land': case 'grass': case 'sand': case 'desert': case 'snow': case 'swamp': if (this.rate('paint', 70)) this.burst({ type: 'highpass', f: r(1800, 3000), a: 0.005, d: 0.06, g: 0.07 * big, pan }); break;
      case 'lava': if (this.rate(id, 100)) { this.burst({ f: 200, to: 60, a: 0.05, d: 0.5, g: 0.18 * big, pan }); this.tone(r(80, 120), { type: 'sawtooth', d: 0.3, g: 0.04 * big, pan }); } break;
      case 'forest': case 'bloom': if (this.rate(id, 120)) this.tone(r(800, 1400), { type: 'sine', d: 0.15, g: 0.06 * big, to: r(1500, 2200), pan, verb: 0.3 }); break;
      case 'heat': if (this.rate(id, 150)) this.burst({ type: 'bandpass', f: 1200, q: 0.6, a: 0.1, d: 0.3, g: 0.08 * big, pan }); break;
      case 'frost': if (this.rate(id, 150)) { this.tone(r(2000, 2600), { type: 'triangle', d: 0.2, g: 0.04 * big, pan, verb: 0.5 }); this.burst({ type: 'highpass', f: 5000, d: 0.1, g: 0.05 * big, pan }); } break;
      case 'human': case 'elf': case 'dwarf': case 'orc': case 'skeleton': case 'troll': case 'sheep': case 'chicken': case 'deer': case 'wolf': case 'bear': this.spawnVoice(id, pan, big); break;
      case 'rain': case 'storm': this.burst({ type: 'bandpass', f: 1800, q: 0.5, a: 0.3, d: 1.2, g: 0.15, pan }); break;
      case 'lightning': case 'smite': this.thunder(big, pan); break;
      case 'fire': if (this.rate(id, 80)) this.burst({ type: 'bandpass', f: r(1500, 3000), q: 3, a: 0.002, d: 0.05, g: 0.12 * big, pan }); break;
      case 'bomb': case 'nuke': this.tone(220, { type: 'square', to: 880, d: 0.18, g: 0.05, pan }); break; // launch click; the blast plays on impact
      case 'meteor': this.burst({ type: 'bandpass', f: 300, to: 1600, q: 1.2, a: 0.8, d: 0.4, g: 0.2 }); break;
      case 'meteorHit': this.boom(big, pan, 1.4); break;
      case 'tornado': this.burst({ type: 'bandpass', f: 500, to: 300, q: 1, a: 0.6, d: 1.8, g: 0.22, pan }); break;
      case 'quake': for (let i = 0; i < 6; i++) this.burst({ f: 120, to: 50, a: 0.05, d: 0.6, g: 0.3, t: t + i * 0.18, rate: 0.5 }); break;
      case 'plague': [0, 3, 6].forEach((n, i) => this.tone(mtof(50 + n), { type: 'sawtooth', d: 0.8, g: 0.05, t: t + i * 0.1, pan, verb: 0.6 })); this.burst({ type: 'bandpass', f: 600, q: 4, a: 0.3, d: 0.6, g: 0.06, pan }); break;
      case 'war': this.horn(false); break;
      case 'peace': case 'alliance': [72, 76, 79, 84].forEach((m, i) => this.tone(mtof(m), { type: 'sine', d: 1.4, g: 0.1, t: t + i * 0.12, verb: 0.9 })); break;
      case 'rebel': this.horn(true); break;
      case 'bless': case 'immortal': case 'crown': case 'strong': case 'brave': case 'fast': [79, 83, 86, 91].forEach((m, i) => this.tone(mtof(m), { type: 'triangle', d: 0.6, g: 0.07, t: t + i * 0.06, verb: 0.8, pan })); break;
      case 'madness': [60, 61, 66].forEach((m, i) => this.tone(mtof(m), { type: 'sawtooth', d: 0.5, g: 0.05, t: t + i * 0.05, pan, detune: r(-30, 30) })); break;
      case 'grab': this.tone(500, { type: 'sine', to: 900, d: 0.12, g: 0.12 }); break;
      case 'drop': this.tone(700, { type: 'sine', to: 400, d: 0.12, g: 0.1 }); break;
      case 'throw': this.burst({ type: 'bandpass', f: 800, to: 3000, q: 1.5, a: 0.05, d: 0.3, g: 0.2 }); this.tone(600, { type: 'sine', to: 1400, d: 0.25, g: 0.06 }); break;
    }
  }

  private spawnVoice(id: string, pan: number, g: number) {
    const t = this.ctx!.currentTime;
    const base = id === 'troll' ? 90 : id === 'dwarf' ? 280 : id === 'orc' ? 180 : id === 'elf' ? 560 : id === 'human' ? 400 : id === 'skeleton' ? 150 : id === 'bear' ? 110 : id === 'wolf' ? 520 : id === 'chicken' ? 900 : id === 'sheep' ? 330 : 450;
    // a little "poof" + creature chirp
    this.burst({ type: 'bandpass', f: 1200, to: 3000, q: 1, a: 0.01, d: 0.18, g: 0.08 * g, pan });
    if (id === 'sheep') { this.tone(base, { type: 'sawtooth', d: 0.35, g: 0.05 * g, t: t + 0.05, pan, to: base * 0.95 }); this.tone(base * 1.01, { type: 'square', d: 0.35, g: 0.02 * g, t: t + 0.05, pan }); }
    else if (id === 'wolf') this.tone(base, { type: 'triangle', to: base * 1.4, glide: 0.3, d: 0.6, g: 0.06 * g, t: t + 0.05, pan, verb: 0.4 });
    else if (id === 'chicken') for (let i = 0; i < 3; i++) this.tone(base * (1 + i * 0.1), { type: 'square', d: 0.05, g: 0.03 * g, t: t + 0.05 + i * 0.07, pan });
    else this.tone(base * (0.9 + Math.random() * 0.25), { type: 'triangle', to: base * 1.5, glide: 0.08, d: 0.12, g: 0.09 * g, t: t + 0.04, pan });
  }

  private boom(g: number, pan: number, size: number) {
    const t = this.ctx!.currentTime;
    this.burst({ f: 900, to: 60, a: 0.005, d: 1.4 * size, g: 0.5 * g, pan, verb: 0.4 });
    this.tone(90, { type: 'sine', to: 32, d: 0.9 * size, g: 0.5 * g, pan });
    this.burst({ type: 'highpass', f: 2500, a: 0.002, d: 0.12, g: 0.18 * g, pan, t });
  }
  private thunder(g: number, pan: number) {
    const t = this.ctx!.currentTime;
    this.burst({ type: 'highpass', f: 1800, a: 0.001, d: 0.08, g: 0.45 * Math.max(0.5, g), pan });
    this.burst({ f: 1500, to: 80, a: 0.01, d: 2.2, g: 0.35 * Math.max(0.4, g), t: t + 0.06, verb: 0.6, pan, rate: 0.7 });
  }
  private horn(minor: boolean) {
    const t = this.ctx!.currentTime;
    const ns = minor ? [55, 58, 62] : [55, 59, 62, 67];
    ns.forEach((m, i) => {
      this.tone(mtof(m), { type: 'sawtooth', a: 0.08, d: 0.9, g: 0.05, t: t + i * 0.22, verb: 0.6 });
      this.tone(mtof(m - 12), { type: 'triangle', a: 0.08, d: 0.9, g: 0.08, t: t + i * 0.22 });
    });
    for (let i = 0; i < 4; i++) this.burst({ f: 180, to: 60, a: 0.002, d: 0.25, g: 0.25, t: t + i * 0.22 });
  }

  /** World events from the simulation (only audible when the camera is close enough). */
  event(t: string, x: number, z: number, a?: number) {
    if (!this.ctx) return;
    const { g, pan } = this.spatial(x, z);
    const near = this.listener.z01 < 0.6 ? 1 : 0.4;
    const r = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
    switch (t) {
      case 'hit': if (g > 0.05 && this.rate('hit', 60)) { this.burst({ type: 'bandpass', f: r(1500, 3000), q: 4, a: 0.001, d: 0.06, g: 0.1 * g * near, pan }); this.tone(r(150, 250), { type: 'triangle', d: 0.08, g: 0.08 * g * near, pan, to: 90 }); } break;
      case 'death': if (g > 0.05 && this.rate('death', 120)) this.tone(r(500, 700), { type: 'triangle', to: 200, d: 0.35, g: 0.07 * g * near, pan }); break;
      case 'gasp': if (g > 0.15 && near === 1 && this.rate('gasp', 260)) { for (let i = 0; i < 3; i++) this.tone(r(500, 900), { type: 'sine', to: r(1100, 1600), d: 0.07, g: 0.035 * g, t: this.ctx!.currentTime + i * 0.06, pan }); this.burst({ type: 'bandpass', f: 900, q: 1.5, d: 0.12, g: 0.05 * g, pan }); } break;
      case 'birth': if (g > 0.1 && this.rate('birth', 400)) [84, 88, 91].forEach((m, i) => this.tone(mtof(m), { type: 'sine', d: 0.3, g: 0.04 * g, t: this.ctx!.currentTime + i * 0.07, pan, verb: 0.5 })); break;
      case 'hammer': if (g > 0.2 && near === 1 && this.rate('hammer', 140)) this.tone(r(900, 1300), { type: 'square', d: 0.03, g: 0.03 * g, pan }); break;
      case 'chop': if (g > 0.2 && near === 1 && this.rate('chop', 150)) { this.tone(r(350, 450), { type: 'triangle', d: 0.05, g: 0.06 * g, pan }); this.burst({ type: 'bandpass', f: 1200, q: 3, d: 0.04, g: 0.04 * g, pan }); } break;
      case 'mine': if (g > 0.2 && near === 1 && this.rate('mine', 150)) this.tone(r(1800, 2600), { type: 'triangle', d: 0.06, g: 0.04 * g, pan }); break;
      case 'built': if (g > 0.15 && this.rate('built', 300)) [72, 79, 84].forEach((m, i) => this.tone(mtof(m), { type: 'triangle', d: 0.4, g: 0.06 * g, t: this.ctx!.currentTime + i * 0.08, pan, verb: 0.4 })); break;
      case 'explosion': this.boom(Math.max(0.3, g), pan, a && a > 4 ? 1.4 : 0.9); break;
      case 'lightning': this.thunder(g, pan); break;
      case 'collapse': if (this.rate('collapse', 200)) this.burst({ f: 600, to: 80, a: 0.02, d: 1.0, g: 0.3 * Math.max(0.3, g), pan, rate: 0.6 }); break;
      case 'levelup': if (g > 0.15) [76, 81, 88].forEach((m, i) => this.tone(mtof(m), { type: 'square', d: 0.15, g: 0.035 * g, t: this.ctx!.currentTime + i * 0.07, pan })); break;
      case 'treefall': if (g > 0.15 && this.rate('treefall', 300)) this.burst({ f: 800, to: 120, a: 0.05, d: 0.5, g: 0.12 * g, pan }); break;
      case 'arrow': if (g > 0.2 && this.rate('arrow', 80)) this.burst({ type: 'bandpass', f: 2500, to: 1200, q: 2, d: 0.15, g: 0.05 * g, pan }); break;
      case 'fling': if (g > 0.1 && this.rate('fling', 120)) this.tone(r(500, 800), { type: 'sine', to: r(1200, 1600), d: 0.3, g: 0.06 * g, pan }); break;
      case 'found': case 'capture': [67, 71, 74, 79].forEach((m, i) => this.tone(mtof(m), { type: 'triangle', d: 0.5, g: 0.06 * Math.max(0.4, g), t: this.ctx!.currentTime + i * 0.1, pan, verb: 0.5 })); break;
      case 'quake': this.play('quake', x, z); break;
      case 'meteorStart': this.play('meteor', x, z); break;
      case 'quakelet': if (g > 0.15 && this.rate('quakelet', 200)) this.burst({ f: 300, to: 60, a: 0.01, d: 0.4, g: 0.2 * g, pan }); break;
      case 'shell': if (this.rate('shell', 90)) { this.boom(Math.max(0.15, g * 0.6), pan, a && a > 0 ? 0.55 : 0.45); } break;
      case 'shot': if (g > 0.1 && this.rate('shot', 70)) { this.burst({ type: 'highpass', f: 900, a: 0.001, d: 0.09, g: 0.16 * g, pan }); this.tone(r(110, 160), { type: 'square', to: 50, d: 0.06, g: 0.06 * g, pan }); } break;
      case 'bombdrop': if (g > 0.1 && this.rate('bombdrop', 300)) this.tone(1400, { type: 'sine', to: 500, d: 0.9, g: 0.05 * g, pan }); break;
      case 'trade': case 'loot': if (g > 0.15 && this.rate('coin', 200)) [88, 93].forEach((m, i) => this.tone(mtof(m), { type: 'square', d: 0.08, g: 0.03 * g, t: this.ctx!.currentTime + i * 0.06, pan })); break;
      case 'arrest': case 'jail': if (g > 0.15 && this.rate('arrest', 300)) { this.tone(mtof(76), { type: 'square', d: 0.12, g: 0.04 * g, pan }); this.tone(mtof(72), { type: 'square', d: 0.12, g: 0.04 * g, t: this.ctx!.currentTime + 0.14, pan }); } break;
      case 'machine': [60, 64, 67, 72].forEach((m, i) => this.tone(mtof(m), { type: 'square', d: 0.15, g: 0.035 * Math.max(0.3, g), t: this.ctx!.currentTime + i * 0.07, pan })); break;
      case 'breath': if (this.rate('breath', 300)) this.burst({ type: 'bandpass', f: 500, to: 1400, q: 0.8, a: 0.05, d: 0.7, g: 0.25 * Math.max(0.3, g), pan }); break;
      case 'ash': if (g > 0.1 && this.rate('ash', 900)) this.burst({ f: 120, to: 50, a: 0.1, d: 1.2, g: 0.25 * g, pan, rate: 0.5 }); break;
      case 'flood': this.burst({ type: 'bandpass', f: 400, to: 200, q: 0.7, a: 0.2, d: 2.5, g: 0.3, pan }); break;
      case 'drought': this.burst({ type: 'bandpass', f: 1600, q: 0.5, a: 0.6, d: 2, g: 0.1, pan }); break;
      case 'launch':
        if (a === 1) { for (let i = 0; i < 3; i++) this.tone(600, { type: 'sawtooth', to: 900, glide: 0.5, d: 0.6, g: 0.05, t: this.ctx!.currentTime + i * 0.6 }); }
        this.tone(a === 1 ? 1500 : 1800, { type: 'sine', to: a === 1 ? 300 : 500, d: a === 1 ? 3.4 : 1.5, g: 0.05 * Math.max(0.4, g), pan });
        break;
      case 'nuke': this.boom(1, 0, 2.2); this.boom(1, 0, 1.6); this.burst({ f: 90, to: 30, a: 0.3, d: 4, g: 0.5, rate: 0.4 }); break;
      case 'era': [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => this.tone(mtof(m), { type: 'triangle', d: 0.7, g: 0.09, t: this.ctx!.currentTime + i * 0.09, verb: 0.8 })); break;
      case 'fish': if (g > 0.25 && this.rate('fish', 400)) this.burst({ type: 'bandpass', f: 1400, q: 2, d: 0.15, g: 0.05 * g, pan }); break;
      case 'land': if (g > 0.1 && this.rate('land', 80)) this.tone(r(140, 200), { type: 'sine', to: 70, d: 0.15, g: 0.12 * g, pan }); break;
    }
  }

  // ------------------------------------------------------------- ambience
  private loopNoise(type: BiquadFilterType, f: number, q: number): { g: GainNode; f: BiquadFilterNode } {
    const c = this.ctx!;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    s.connect(fl).connect(g).connect(this.amb);
    s.start();
    return { g, f: fl };
  }
  private wind!: { g: GainNode; f: BiquadFilterNode };
  private surf!: { g: GainNode; f: BiquadFilterNode };
  private rain!: { g: GainNode; f: BiquadFilterNode };
  private fire!: { g: GainNode; f: BiquadFilterNode };
  private initAmbience() {
    this.wind = this.loopNoise('bandpass', 500, 0.7);
    this.surf = this.loopNoise('lowpass', 600, 0.5);
    this.rain = this.loopNoise('highpass', 2500, 0.3);
    this.fire = this.loopNoise('bandpass', 1800, 2.5);
  }

  /** Called every frame with what the camera currently sees. */
  update(dt: number, s: { water: number; forest: number; village: number; rain: number; fire: number; war: number; paused: boolean }) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const L = this.listener;
    const high = Math.min(1, L.z01 * 1.3);
    const near = 1 - Math.min(1, L.z01 / 0.6);
    const set = (g: GainNode, v: number) => g.gain.setTargetAtTime(v, t, 0.6);
    set(this.wind.g, 0.05 + high * 0.18);
    this.wind.f.frequency.setTargetAtTime(380 + Math.sin(t * 0.3) * 150 + high * 300, t, 0.5);
    const swell = 0.6 + 0.4 * Math.sin(t * 0.5) * Math.sin(t * 0.21);
    set(this.surf.g, s.water * (0.12 + near * 0.2) * swell);
    set(this.rain.g, s.rain * 0.22);
    set(this.fire.g, Math.min(1, s.fire) * 0.12 * (0.5 + near));
    // birds & village chatter as random grains
    if (!s.paused && near > 0.2 && s.forest > 0.1 && Math.random() < dt * 1.5 * s.forest * near) this.bird();
    if (!s.paused && near > 0.3 && s.village > 0.1 && Math.random() < dt * 2.2 * s.village * near) this.chatter();
    this.mood += ((s.war > 0 ? 1 : 0) - this.mood) * Math.min(1, dt * 0.2);
    this.music();
  }
  private bird() {
    const t = this.ctx!.currentTime;
    const base = 2200 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 4), pan = Math.random() * 1.4 - 0.7;
    for (let i = 0; i < n; i++) this.tone(base * (1 + Math.random() * 0.2), { type: 'sine', to: base * 1.4, glide: 0.06, d: 0.07, g: 0.025, t: t + i * 0.1, dest: this.amb, pan, verb: 0.3 });
  }
  private chatter() {
    // cute gibberish voices
    const t = this.ctx!.currentTime;
    const base = 250 + Math.random() * 300, n = 3 + Math.floor(Math.random() * 5), pan = Math.random() * 1.2 - 0.6;
    for (let i = 0; i < n; i++) this.tone(base * (0.85 + Math.random() * 0.4), { type: 'triangle', to: base * (0.9 + Math.random() * 0.5), glide: 0.06, a: 0.01, d: 0.06, g: 0.02, t: t + i * 0.085, dest: this.amb, pan });
  }

  // ------------------------------------------------------------- generative score
  private music() {
    const c = this.ctx!;
    const bpm = 78 + this.mood * 18;
    const spb = 60 / bpm / 2; // eighth notes
    while (this.nextNote < c.currentTime + 0.25) {
      const t = this.nextNote;
      const war = this.mood > 0.5;
      const scale = war ? MINOR : PENT;
      const prog = war ? [0, -4, -2, -5] : [0, 7, 9, 5];
      if (this.step % 16 === 0) this.chord = prog[(this.step / 16) % 4];
      const root = 57 + this.chord;
      // pad at bar start
      if (this.step % 16 === 0) {
        const third = war ? 3 : 4;
        for (const n of [0, third, 7, 12]) this.tone(mtof(root - 12 + n), { type: 'sawtooth', a: 0.8, d: spb * 16, g: 0.012, t, dest: this.mus, detune: Math.random() * 12 - 6, verb: 0.7 });
        this.tone(mtof(root - 24), { type: 'sine', a: 0.1, d: spb * 14, g: 0.06, t, dest: this.mus });
      }
      // plucked melody
      if (Math.random() < (war ? 0.35 : 0.42) && this.step % 2 === 0) {
        const deg = scale[Math.floor(Math.random() * scale.length)] + (Math.random() < 0.3 ? 12 : 0);
        this.tone(mtof(root + 12 + deg), { type: 'triangle', a: 0.005, d: 0.6, g: 0.035, t, dest: this.mus, verb: 0.6, pan: Math.random() * 0.6 - 0.3 });
      }
      // gentle percussion; war drums
      if (war) {
        if (this.step % 4 === 0) { this.tone(70, { type: 'sine', to: 40, d: 0.3, g: 0.12 * this.mood, t, dest: this.mus }); }
        if (this.step % 8 === 6) this.burst({ f: 300, to: 100, d: 0.2, g: 0.06 * this.mood, t, dest: this.mus });
      } else if (this.step % 8 === 4) this.burst({ type: 'highpass', f: 6000, d: 0.04, g: 0.012, t, dest: this.mus });
      this.nextNote += spb;
      this.step++;
    }
  }
}

export const audio = new AudioEngine();
