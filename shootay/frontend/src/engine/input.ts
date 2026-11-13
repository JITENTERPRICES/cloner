// Unified input: keyboard + mouse (pointer lock) on desktop, virtual stick + buttons on touch screens.
// Gameplay code only reads this object, so both control schemes behave identically.
import { app, bus } from '../state';
import { saveSettings } from '../net/net';

type Btn = 'fire' | 'ads' | 'jump' | 'crouch' | 'reload' | 'swap' | 'fireb';
// default centre of each touch button in % of the screen (x from left, y from top), right-handed
const DEFAULT_POS: Record<Btn, [number, number]> = { fire: [86, 62], ads: [93, 38], jump: [93, 84], crouch: [78, 86], reload: [74, 44], swap: [66, 88], fireb: [9, 34] };
const LABEL: Record<Btn, string> = { fire: 'FIRE', ads: 'ADS', jump: 'JUMP', crouch: 'SLIDE', reload: 'RELOAD', swap: 'SWAP', fireb: 'FIRE' };
const SIZE: Record<Btn, number> = { fire: 76, ads: 56, jump: 60, crouch: 58, reload: 50, swap: 50, fireb: 58 };

export class Input {
  moveX = 0; moveZ = 0; lookDX = 0; lookDY = 0;
  fire = false; ads = false; sprint = false; crouch = false; scoreboard = false;
  // one-shot presses, consumed by the game each frame
  jump = false; crouchTap = false; reload = false; swap = false; inspect = false; slot: number | null = null;
  enabled = false; locked = false; editing = false;
  private keys = new Set<string>();
  private root: HTMLElement;
  private stick = { id: -1, ox: 0, oy: 0 };
  private look = new Map<number, { x: number; y: number }>();
  private btnEls = new Map<Btn, HTMLElement>();
  private stickEl!: HTMLElement; private knobEl!: HTMLElement;

  constructor(private canvas: HTMLCanvasElement) {
    this.root = document.getElementById('touch')!;
    addEventListener('keydown', (e) => this.key(e, true));
    addEventListener('keyup', (e) => this.key(e, false));
    addEventListener('blur', () => { this.keys.clear(); this.fire = this.ads = false; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked && this.enabled && !app.touch) bus.emit('pause');
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || app.touch) return;
      if (!this.locked) { this.lock(); return; }
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.ads = app.settings.controls.adsToggle ? !this.ads : true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.fire = false; if (e.button === 2 && !app.settings.controls.adsToggle) this.ads = false; });
    addEventListener('mousemove', (e) => { if (this.locked && this.enabled) { this.lookDX += e.movementX; this.lookDY += e.movementY; } });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', () => { if (this.locked && this.enabled) this.swap = true; }, { passive: true });
    if (app.touch) this.buildTouch();
    bus.on('settings', () => this.layout());
  }
  lock() { if (!app.touch) (this.canvas.requestPointerLock() as any)?.catch?.(() => {}); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  setEnabled(on: boolean) {
    this.enabled = on;
    this.root.style.display = on && app.touch ? 'block' : 'none';
    if (!on) { this.fire = this.ads = this.crouch = this.sprint = this.scoreboard = false; this.moveX = this.moveZ = 0; this.keys.clear(); this.stick.id = -1; this.look.clear(); }
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (!this.enabled || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.code;
    if (k === 'Tab') { e.preventDefault(); this.scoreboard = down; return; }
    if (down && !e.repeat) {
      if (k === 'Space') { this.jump = true; e.preventDefault(); }
      if (k === 'KeyC' || k === 'ControlLeft') { this.crouchTap = true; if (app.settings.controls.crouchToggle) this.crouch = !this.crouch; }
      if (k === 'KeyR') this.reload = true;
      if (k === 'KeyQ') this.swap = true;
      if (k === 'KeyF') this.inspect = true;
      if (k === 'Digit1') this.slot = 0;
      if (k === 'Digit2') this.slot = 1;
    }
    down ? this.keys.add(k) : this.keys.delete(k);
  }
  /** Call once per frame before reading movement. */
  poll() {
    if (app.touch) return;
    const k = this.keys;
    this.moveX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    this.moveZ = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    if (!app.settings.controls.crouchToggle) this.crouch = k.has('KeyC') || k.has('ControlLeft');
  }
  consume() { this.jump = this.crouchTap = this.reload = this.swap = this.inspect = false; this.slot = null; this.lookDX = this.lookDY = 0; }

  // ───────────── touch controls ─────────────
  private buildTouch() {
    const r = this.root;
    r.innerHTML = '<div class="t-zone t-move"></div><div class="t-zone t-look"></div><div class="t-stick"><div class="t-knob"></div></div><button class="t-top t-pause">II</button><button class="t-top t-score">≡</button>';
    this.stickEl = r.querySelector('.t-stick')!; this.knobEl = r.querySelector('.t-knob')!;
    const move = r.querySelector<HTMLElement>('.t-move')!, look = r.querySelector<HTMLElement>('.t-look')!;
    move.addEventListener('pointerdown', (e) => {
      if (this.stick.id !== -1 || this.editing) return;
      move.setPointerCapture(e.pointerId);
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this.stickEl.style.display = 'block'; this.stickEl.style.left = e.clientX + 'px'; this.stickEl.style.top = e.clientY + 'px';
    });
    move.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stick.id) return;
      const R = 52 * app.settings.touch.scale;
      let dx = (e.clientX - this.stick.ox) / R, dy = (e.clientY - this.stick.oy) / R;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      this.moveX = Math.abs(dx) < 0.12 ? 0 : dx; this.moveZ = Math.abs(dy) < 0.12 ? 0 : -dy;
      this.sprint = app.settings.controls.autoSprint && -dy > 0.86;
      this.knobEl.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
    });
    const endStick = (e: PointerEvent) => { if (e.pointerId !== this.stick.id) return; this.stick.id = -1; this.moveX = this.moveZ = 0; this.sprint = false; this.stickEl.style.display = 'none'; this.knobEl.style.transform = ''; };
    move.addEventListener('pointerup', endStick); move.addEventListener('pointercancel', endStick);
    // camera look: any finger on the right half, and also fingers resting on buttons (so you can aim while firing)
    const lookStart = (e: PointerEvent) => this.look.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const lookMove = (e: PointerEvent) => {
      const p = this.look.get(e.pointerId); if (!p) return;
      const s = 2.4 * app.settings.controls.touchSensitivity;
      this.lookDX += (e.clientX - p.x) * s; this.lookDY += (e.clientY - p.y) * s;
      p.x = e.clientX; p.y = e.clientY;
    };
    const lookEnd = (e: PointerEvent) => this.look.delete(e.pointerId);
    look.addEventListener('pointerdown', (e) => { if (!this.editing) { look.setPointerCapture(e.pointerId); lookStart(e); } });
    look.addEventListener('pointermove', lookMove); look.addEventListener('pointerup', lookEnd); look.addEventListener('pointercancel', lookEnd);

    for (const b of Object.keys(DEFAULT_POS) as Btn[]) {
      const el = document.createElement('button');
      el.className = 't-btn t-' + b; el.textContent = LABEL[b];
      let drag: { id: number } | null = null;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); el.setPointerCapture(e.pointerId);
        if (this.editing) { drag = { id: e.pointerId }; return; }
        el.classList.add('on'); lookStart(e);
        if (b === 'fire' || b === 'fireb') this.fire = true;
        if (b === 'ads') this.ads = !this.ads; // toggle on touch: holding two buttons while aiming is awkward
        if (b === 'jump') this.jump = true;
        if (b === 'crouch') { this.crouchTap = true; this.crouch = !this.crouch; }
        if (b === 'reload') this.reload = true;
        if (b === 'swap') this.swap = true;
        el.classList.toggle('held', (b === 'ads' && this.ads) || (b === 'crouch' && this.crouch));
      });
      el.addEventListener('pointermove', (e) => {
        if (drag && drag.id === e.pointerId) {
          let x = (e.clientX / innerWidth) * 100; const y = (e.clientY / innerHeight) * 100;
          if (app.settings.touch.leftHanded) x = 100 - x;
          app.settings.touch.positions[b] = [Math.max(3, Math.min(97, x)), Math.max(8, Math.min(95, y))];
          this.layout();
        } else lookMove(e);
      });
      const up = (e: PointerEvent) => {
        if (drag) { drag = null; saveSettings(); return; }
        el.classList.remove('on'); lookEnd(e);
        if (b === 'fire' || b === 'fireb') this.fire = false;
      };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      r.appendChild(el); this.btnEls.set(b, el);
    }
    r.querySelector('.t-pause')!.addEventListener('click', () => bus.emit('pause'));
    const score = r.querySelector<HTMLElement>('.t-score')!;
    score.addEventListener('pointerdown', () => (this.scoreboard = true));
    score.addEventListener('pointerup', () => (this.scoreboard = false)); score.addEventListener('pointercancel', () => (this.scoreboard = false));
    this.layout();
  }
  /** Releases toggled touch states (used on respawn). */
  resetToggles() { this.ads = false; this.crouch = false; this.btnEls.forEach((el) => el.classList.remove('held')); }
  layout() {
    if (!app.touch) return;
    const t = app.settings.touch;
    this.root.classList.toggle('lefty', t.leftHanded);
    this.root.classList.toggle('editing', this.editing);
    for (const [b, el] of this.btnEls) {
      const [x, y] = t.positions[b] ?? DEFAULT_POS[b];
      const s = SIZE[b] * t.scale;
      Object.assign(el.style, { left: (t.leftHanded ? 100 - x : x) + '%', top: y + '%', width: s + 'px', height: s + 'px', opacity: String(this.editing ? 0.95 : t.opacity) });
    }
  }
  setEditing(on: boolean) { this.editing = on; this.root.style.display = on || (this.enabled && app.touch) ? 'block' : 'none'; this.layout(); }
  resetLayout() { app.settings.touch.positions = {}; saveSettings(); }
}
