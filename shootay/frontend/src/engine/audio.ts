// Sound. Effects (weapons, reloads, footsteps, UI, stingers, ambience) are synthesised with WebAudio,
// so there are no SFX files to ship. MUSIC is different: the lobby playlist plays ONLY the developer's
// supplied recordings (extracted to assets/music by scripts/extract-audio.sh). If they are not installed
// the player says so — it never substitutes generated music.
import { app, bus } from '../state';
import { musicBase, saveSettings } from '../net/net';
import { WeaponCat } from '../../../shared/weapons';

let ctx: AudioContext | null = null;
let master: GainNode, sfxBus: GainNode, ambBus: GainNode;
let noiseBuf: AudioBuffer;
const listener = { x: 0, y: 0, z: 0, yaw: 0 };

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.connect(ctx.destination);
  const comp = ctx.createDynamicsCompressor(); comp.connect(master);
  sfxBus = ctx.createGain(); sfxBus.connect(comp);
  ambBus = ctx.createGain(); ambBus.connect(comp);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  applyVolumes();
  return ctx;
}
function applyVolumes() {
  if (!ctx) return;
  const a = app.settings.audio;
  master.gain.value = a.master; sfxBus.gain.value = a.sfx; ambBus.gain.value = a.ambience * 0.5;
}
bus.on('settings', () => { applyVolumes(); music.applyVolume(); });
/** Browsers only allow audio after a user gesture. */
export function unlockAudio() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); }
export function setListener(x: number, y: number, z: number, yaw: number) { Object.assign(listener, { x, y, z, yaw }); }

/** Output node for a sound at a world position: distance attenuation + stereo pan. null = too far to hear. */
function spatial(pos: [number, number, number] | null, range: number): AudioNode | null {
  if (!pos) return sfxBus;
  const dx = pos[0] - listener.x, dy = pos[1] - listener.y, dz = pos[2] - listener.z;
  const d = Math.hypot(dx, dy, dz);
  if (d > range) return null;
  const g = ctx!.createGain();
  g.gain.value = Math.pow(1 - d / range, 1.6);
  // right vector of the listener for yaw: (cos, 0, -sin)
  const pan = d < 0.5 ? 0 : (dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / d;
  const p = ctx!.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
  g.connect(p); p.connect(sfxBus);
  return g;
}
function noise(out: AudioNode, t: number, dur: number, gain: number, type: BiquadFilterType, f0: number, f1: number, qv = 0.8) {
  const c = ctx!, src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = c.createBiquadFilter(); f.type = type; f.Q.value = qv;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t, Math.random()); src.stop(t + dur + 0.02);
}
function tone(out: AudioNode, t: number, dur: number, gain: number, type: OscillatorType, f0: number, f1 = f0, attack = 0.004) {
  const c = ctx!, o = c.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
}

const SHOT: Record<WeaponCat, { body: number; crack: number; len: number; low: number }> = {
  ar: { body: 0.75, crack: 0.6, len: 0.2, low: 150 }, smg: { body: 0.5, crack: 0.55, len: 0.13, low: 210 }, shotgun: { body: 1, crack: 0.75, len: 0.36, low: 85 },
  sniper: { body: 1, crack: 0.9, len: 0.6, low: 70 }, pistol: { body: 0.55, crack: 0.6, len: 0.15, low: 190 }, lmg: { body: 0.85, crack: 0.6, len: 0.24, low: 120 },
};
export const sfx = {
  shot(cat: WeaponCat, pitch: number, silent: boolean, pos: [number, number, number] | null = null) {
    if (!ensure()) return;
    const out = spatial(pos, silent ? 30 : 110); if (!out) return;
    const t = ctx!.currentTime, s = SHOT[cat], k = pos ? 0.8 : 1;
    if (silent) { noise(out, t, 0.09, 0.35 * k, 'bandpass', 1800 * pitch, 500, 1.2); tone(out, t, 0.06, 0.2 * k, 'sine', 240, 90); return; }
    noise(out, t, s.len * 0.35, s.crack * k, 'highpass', 2600 * pitch, 900); // crack
    noise(out, t, s.len, s.body * 0.8 * k, 'lowpass', 2200 * pitch, 180); // body
    tone(out, t, s.len * 0.8, s.body * 0.9 * k, 'sine', s.low * 1.8, s.low * 0.5); // thump
    noise(out, t + 0.03, s.len * 2.4, 0.12 * k, 'bandpass', 900, 300, 0.4); // tail off the buildings
  },
  reload(dur: number, cat: WeaponCat) {
    if (!ensure()) return;
    const t = ctx!.currentTime, click = (at: number, f: number, g = 0.3) => { noise(sfxBus, t + at, 0.05, g, 'bandpass', f, f * 0.6, 3); tone(sfxBus, t + at, 0.03, g * 0.5, 'square', f * 0.25, f * 0.12); };
    click(dur * 0.22, 1700); // mag release
    noise(sfxBus, t + dur * 0.3, 0.12, 0.08, 'lowpass', 900, 300); // cloth / hand movement
    click(dur * 0.62, 1200, 0.35); click(dur * 0.66, 2100, 0.2); // mag seated
    if (cat !== 'pistol') { click(dur * 0.82, 2600, 0.3); click(dur * 0.9, 1900, 0.36); } else click(dur * 0.86, 2400, 0.34); // charging handle / slide
  },
  dry() { if (ensure()) { noise(sfxBus, ctx!.currentTime, 0.04, 0.25, 'bandpass', 2400, 1800, 4); } },
  swap() { if (ensure()) { const t = ctx!.currentTime; noise(sfxBus, t, 0.14, 0.12, 'lowpass', 1400, 400); noise(sfxBus, t + 0.2, 0.05, 0.22, 'bandpass', 1900, 1200, 3); } },
  footstep(pos: [number, number, number] | null, loud: number) {
    if (!ensure()) return;
    const out = spatial(pos, 22); if (!out) return;
    const t = ctx!.currentTime;
    noise(out, t, 0.08, 0.22 * loud, 'lowpass', 700 + Math.random() * 300, 200); tone(out, t, 0.06, 0.16 * loud, 'sine', 95 + Math.random() * 20, 55);
  },
  land(strength: number) { if (ensure()) { const t = ctx!.currentTime; noise(sfxBus, t, 0.16, 0.3 * strength, 'lowpass', 600, 120); tone(sfxBus, t, 0.14, 0.3 * strength, 'sine', 90, 45); } },
  slide() { if (ensure()) noise(sfxBus, ctx!.currentTime, 0.7, 0.22, 'bandpass', 1500, 400, 0.5); },
  jump() { if (ensure()) noise(sfxBus, ctx!.currentTime, 0.1, 0.1, 'lowpass', 900, 300); },
  hit(head: boolean) { if (ensure()) { const t = ctx!.currentTime; tone(sfxBus, t, 0.05, 0.22, 'square', head ? 1900 : 1250, head ? 1500 : 950); if (head) tone(sfxBus, t + 0.04, 0.09, 0.2, 'sine', 2600); } },
  kill() { if (ensure()) { const t = ctx!.currentTime; tone(sfxBus, t, 0.09, 0.22, 'triangle', 660); tone(sfxBus, t + 0.08, 0.2, 0.24, 'triangle', 990); noise(sfxBus, t, 0.2, 0.1, 'highpass', 5000, 3000); } },
  hurt() { if (ensure()) { const t = ctx!.currentTime; noise(sfxBus, t, 0.12, 0.3, 'lowpass', 500, 120); tone(sfxBus, t, 0.1, 0.25, 'sine', 140, 60); } },
  impact(pos: [number, number, number]) { if (!ensure()) return; const out = spatial(pos, 25); if (out) noise(out, ctx!.currentTime, 0.05, 0.14, 'bandpass', 3200 + Math.random() * 1500, 1500, 2); },
  explosion(pos: [number, number, number]) {
    if (!ensure()) return;
    const out = spatial(pos, 160); if (!out) return;
    const t = ctx!.currentTime;
    noise(out, t, 1.4, 1, 'lowpass', 1800, 60); tone(out, t, 0.9, 1, 'sine', 110, 28); noise(out, t, 0.2, 0.7, 'highpass', 3000, 800); noise(out, t + 0.15, 2.2, 0.2, 'bandpass', 500, 150, 0.4);
  },
  ui(kind: 'click' | 'hover' | 'back' | 'error' | 'equip' | 'buy' = 'click') {
    if (!ensure()) return;
    const t = ctx!.currentTime;
    if (kind === 'click') tone(sfxBus, t, 0.05, 0.1, 'triangle', 720, 560);
    else if (kind === 'hover') tone(sfxBus, t, 0.025, 0.04, 'sine', 1100);
    else if (kind === 'back') tone(sfxBus, t, 0.06, 0.09, 'triangle', 480, 330);
    else if (kind === 'error') { tone(sfxBus, t, 0.09, 0.12, 'sawtooth', 190, 150); tone(sfxBus, t + 0.1, 0.12, 0.12, 'sawtooth', 150, 120); }
    else if (kind === 'equip') { noise(sfxBus, t, 0.05, 0.2, 'bandpass', 2000, 1200, 3); tone(sfxBus, t + 0.04, 0.08, 0.1, 'triangle', 520, 780); }
    else { tone(sfxBus, t, 0.08, 0.12, 'triangle', 660); tone(sfxBus, t + 0.07, 0.08, 0.12, 'triangle', 880); tone(sfxBus, t + 0.14, 0.16, 0.12, 'triangle', 1320); }
  },
  countdown(final: boolean) { if (ensure()) tone(sfxBus, ctx!.currentTime, final ? 0.5 : 0.12, 0.2, 'square', final ? 880 : 440); },
  /** Matchmaking: a soft two-note radar pulse. */
  searching() { if (ensure()) { const t = ctx!.currentTime; tone(sfxBus, t, 0.5, 0.1, 'sine', 392, 392, 0.05); tone(sfxBus, t + 0.25, 0.6, 0.08, 'sine', 587, 587, 0.05); } },
  matchFound() { if (ensure()) { const t = ctx!.currentTime; [392, 523, 659, 784].forEach((f, i) => tone(sfxBus, t + i * 0.09, 0.3, 0.14, 'triangle', f)); noise(sfxBus, t, 0.5, 0.1, 'highpass', 6000, 2000); } },
  victory() { if (ensure()) { const t = ctx!.currentTime; [[392, 0], [523, 0.16], [659, 0.32], [784, 0.48], [1047, 0.7]].forEach(([f, d]) => { tone(sfxBus, t + d, 0.7, 0.16, 'sawtooth', f, f, 0.02); tone(sfxBus, t + d, 0.7, 0.12, 'triangle', f / 2, f / 2, 0.02); }); tone(sfxBus, t + 0.7, 1.6, 0.14, 'triangle', 1319, 1319, 0.05); } },
  defeat() { if (ensure()) { const t = ctx!.currentTime; [[392, 0], [349, 0.3], [311, 0.6], [233, 0.95]].forEach(([f, d]) => { tone(sfxBus, t + d, 0.8, 0.15, 'sawtooth', f, f * 0.97, 0.03); tone(sfxBus, t + d, 0.8, 0.14, 'sine', f / 2, f / 2 * 0.97, 0.03); }); } },
  capture() { if (ensure()) { const t = ctx!.currentTime; tone(sfxBus, t, 0.15, 0.15, 'triangle', 523); tone(sfxBus, t + 0.12, 0.3, 0.15, 'triangle', 784); } },
  boxShake() { if (ensure()) { const t = ctx!.currentTime; for (let i = 0; i < 6; i++) noise(sfxBus, t + i * 0.22, 0.09, 0.22, 'bandpass', 500 + i * 180, 300, 2); tone(sfxBus, t, 1.5, 0.12, 'sawtooth', 60, 240, 0.4); } },
  reveal(rank: number) {
    if (!ensure()) return;
    const t = ctx!.currentTime, base = [392, 440, 523, 587, 659, 784][rank] ?? 392;
    noise(sfxBus, t, 0.5, 0.3, 'highpass', 800, 7000);
    for (let i = 0; i <= Math.min(rank, 4); i++) tone(sfxBus, t + i * 0.08, 0.9, 0.13, 'triangle', base * [1, 1.25, 1.5, 2, 2.5][i]);
    if (rank >= 4) tone(sfxBus, t, 1.6, 0.2, 'sine', base / 4, base / 4, 0.05);
  },
};

// ── environmental ambience: wind, city hum and occasional distant events ──
let amb: { stop(): void } | null = null;
export function startAmbience(kind: 'urban' | 'industrial' | 'downtown' | 'lobby') {
  stopAmbience();
  const c = ensure(); if (!c) return;
  const nodes: AudioScheduledSourceNode[] = [];
  const wind = c.createBufferSource(); wind.buffer = noiseBuf; wind.loop = true;
  const wf = c.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = kind === 'industrial' ? 260 : 420;
  const wg = c.createGain(); wg.gain.value = 0.5;
  const lfo = c.createOscillator(); lfo.frequency.value = 0.09; const lg = c.createGain(); lg.gain.value = 140; lfo.connect(lg); lg.connect(wf.frequency);
  wind.connect(wf); wf.connect(wg); wg.connect(ambBus); wind.start(); lfo.start(); nodes.push(wind, lfo);
  const hum = c.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = kind === 'industrial' ? 49 : kind === 'downtown' ? 60 : 55;
  const hf = c.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 130; const hg = c.createGain(); hg.gain.value = kind === 'industrial' ? 0.22 : 0.1;
  hum.connect(hf); hf.connect(hg); hg.connect(ambBus); hum.start(); nodes.push(hum);
  const timer = window.setInterval(() => {
    if (!ctx || Math.random() > 0.45) return;
    const t = ctx.currentTime;
    if (kind === 'industrial') { noise(ambBus, t, 1.2, 0.18, 'bandpass', 300 + Math.random() * 500, 150, 6); tone(ambBus, t, 0.9, 0.08, 'sine', 180 + Math.random() * 80, 90); } // metal groan
    else if (Math.random() < 0.5) { for (let i = 0; i < 3; i++) { tone(ambBus, t + i * 0.9, 0.9, 0.035, 'sine', 620, 880, 0.3); } } // far siren
    else noise(ambBus, t, 2.5, 0.07, 'bandpass', 220, 90, 0.7); // passing traffic
  }, 7000);
  amb = { stop() { clearInterval(timer); for (const n of nodes) { try { n.stop(); } catch { /* already stopped */ } } wg.disconnect(); hg.disconnect(); } };
}
export function stopAmbience() { amb?.stop(); amb = null; }

// ── music player: the supplied soundtrack only ──
export interface Track { title: string; file: string; source: string; duration?: number }
class MusicPlayer {
  tracks: Track[] = [];
  /** 'missing' = the supplied MP4s have not been extracted into assets/music yet. */
  status: 'loading' | 'ready' | 'missing' = 'loading';
  index = 0; playing = false;
  private el = new Audio();
  private duck = 1; private order: number[] = [];
  constructor() {
    this.el.preload = 'none';
    this.el.addEventListener('ended', () => this.onEnded());
    this.el.addEventListener('timeupdate', () => bus.emit('music'));
    this.el.addEventListener('error', () => { if (this.playing) { this.playing = false; bus.emit('music'); } });
  }
  async load() {
    try {
      const r = await fetch(musicBase + '/manifest.json', { cache: 'no-store' });
      if (!r.ok) throw new Error('no manifest');
      const m = await r.json();
      this.tracks = Array.isArray(m.tracks) ? m.tracks.filter((t: any) => typeof t?.file === 'string' && /^[\w.-]+$/.test(t.file)) : [];
      this.status = this.tracks.length ? 'ready' : 'missing';
    } catch { this.tracks = []; this.status = 'missing'; }
    this.index = Math.min(app.settings.audio.track, Math.max(0, this.tracks.length - 1));
    this.reshuffle();
    bus.emit('music');
  }
  private reshuffle() { this.order = this.tracks.map((_, i) => i).sort(() => Math.random() - 0.5); }
  get current() { return this.tracks[this.index]; }
  get time() { return this.el.currentTime || 0; }
  get duration() { return Number.isFinite(this.el.duration) ? this.el.duration : this.current?.duration ?? 0; }
  applyVolume() { const a = app.settings.audio; this.el.volume = Math.max(0, Math.min(1, (a.musicMuted ? 0 : a.music) * a.master * this.duck)); }
  select(i: number, autoplay = true) {
    if (!this.tracks.length) return;
    this.index = ((i % this.tracks.length) + this.tracks.length) % this.tracks.length;
    app.settings.audio.track = this.index; saveSettings();
    this.el.src = `${musicBase}/${this.current.file}`;
    if (autoplay) this.play(); else bus.emit('music');
  }
  play() {
    if (!this.tracks.length) return;
    if (!this.el.src) this.el.src = `${musicBase}/${this.current.file}`;
    this.applyVolume();
    this.el.play().then(() => { this.playing = true; bus.emit('music'); }).catch(() => { this.playing = false; bus.emit('music'); });
  }
  pause() { this.el.pause(); this.playing = false; bus.emit('music'); }
  toggle() { this.playing ? this.pause() : this.play(); }
  next(auto = false) {
    const a = app.settings.audio;
    if (a.shuffle && this.tracks.length > 1) { const at = this.order.indexOf(this.index); if (at === this.order.length - 1) this.reshuffle(); this.select(this.order[(at + 1) % this.order.length]); return; }
    if (auto && a.repeat === 'off' && this.index === this.tracks.length - 1) { this.pause(); return; }
    this.select(this.index + 1);
  }
  prev() { if (this.el.currentTime > 3) { this.el.currentTime = 0; return; } this.select(this.index - 1); }
  seek(frac: number) { if (this.duration) this.el.currentTime = frac * this.duration; }
  private onEnded() { if (app.settings.audio.repeat === 'one') { this.el.currentTime = 0; this.play(); } else this.next(true); }
  /** Lower the music when a match starts (0..1), restore it in the lobby. */
  setDuck(level: number) {
    const from = this.duck, t0 = performance.now();
    const step = () => { const k = Math.min(1, (performance.now() - t0) / 900); this.duck = from + (level - from) * k; this.applyVolume(); if (k < 1) requestAnimationFrame(step); };
    step();
  }
}
export const music = new MusicPlayer();
