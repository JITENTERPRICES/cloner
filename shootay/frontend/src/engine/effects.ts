// Pooled visual effects: voxel particles (sparks, dust, smoke, stylised blood), tracers, impact decals
// and explosions. Everything is instanced/pooled so effects never allocate during a firefight.
import * as THREE from 'three';
import { app } from '../state';
import { glowTexture } from './world';

const MAXP = 500, MAXD = 96, MAXT = 28;
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
const UP = new THREE.Vector3(0, 0, 1);

export class Effects {
  private parts: THREE.InstancedMesh;
  private px = new Float32Array(MAXP * 3); private pv = new Float32Array(MAXP * 3);
  private life = new Float32Array(MAXP); private max = new Float32Array(MAXP); private size = new Float32Array(MAXP); private grav = new Float32Array(MAXP); private grow = new Float32Array(MAXP);
  private pi = 0;
  private decals: THREE.InstancedMesh; private di = 0;
  private tracers: { mesh: THREE.Mesh; life: number }[] = [];
  private ti = 0;
  private flashes: { light: THREE.PointLight; sprite: THREE.Sprite; life: number }[] = [];
  shake = 0;

  constructor(private scene: THREE.Scene) {
    this.parts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 }), MAXP);
    this.parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.parts.frustumCulled = false;
    m4.makeScale(0, 0, 0);
    for (let i = 0; i < MAXP; i++) { this.parts.setMatrixAt(i, m4); this.parts.setColorAt(i, col.set(0xffffff)); }
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), MAXD);
    this.decals.frustumCulled = false;
    for (let i = 0; i < MAXD; i++) { this.decals.setMatrixAt(i, m4); this.decals.setColorAt(i, col.set(0x000000)); }
    const tg = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < MAXT; i++) {
      const mesh = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      mesh.frustumCulled = false; mesh.visible = false;
      this.tracers.push({ mesh, life: 0 }); scene.add(mesh);
    }
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(0xffa040, 0, 26, 1.4);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb060, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      this.flashes.push({ light, sprite, life: 0 }); scene.add(light, sprite);
    }
    scene.add(this.parts, this.decals);
  }
  private get density() { return app.settings.graphics.particles; }
  private get gore() { return app.settings.gore; }

  private emit(p: THREE.Vector3, vel: THREE.Vector3, color: number, size: number, life: number, grav: number, grow = 0) {
    const i = this.pi; this.pi = (this.pi + 1) % MAXP;
    this.px.set([p.x, p.y, p.z], i * 3); this.pv.set([vel.x, vel.y, vel.z], i * 3);
    this.life[i] = this.max[i] = life; this.size[i] = size; this.grav[i] = grav; this.grow[i] = grow;
    this.parts.setColorAt(i, col.set(color));
    this.parts.instanceColor!.needsUpdate = true;
  }
  private burst(p: THREE.Vector3, n: THREE.Vector3 | null, count: number, color: number | number[], speed: number, size: number, life: number, grav: number, grow = 0) {
    const c = Math.round(count * (0.3 + 0.7 * this.density));
    for (let i = 0; i < c; i++) {
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random() * 0.7));
      if (n) v.addScaledVector(n, speed * 0.7);
      this.emit(p, v, Array.isArray(color) ? color[(Math.random() * color.length) | 0] : color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.8), grav, grow);
    }
  }
  private decal(p: THREE.Vector3, n: THREE.Vector3, size: number, color: number) {
    const i = this.di; this.di = (this.di + 1) % MAXD;
    q.setFromUnitVectors(UP, n);
    m4.compose(v.copy(p).addScaledVector(n, 0.012), q, sc.set(size, size, 1));
    this.decals.setMatrixAt(i, m4); this.decals.setColorAt(i, col.set(color));
    this.decals.instanceMatrix.needsUpdate = true; this.decals.instanceColor!.needsUpdate = true;
  }

  /** Bullet hitting the world: sparks, dust puff and a bullet-hole decal. */
  impact(p: THREE.Vector3, n: THREE.Vector3) {
    this.burst(p, n, 5, [0xffd28a, 0xffa040], 4, 0.035, 0.25, 12);
    this.burst(p, n, 4, [0x55555a, 0x3a3a40], 1.2, 0.09, 0.7, -0.6, 0.25);
    this.decal(p, n, 0.12 + Math.random() * 0.05, 0x050506);
  }
  /** Stylised hit on a player. Scales with the gore setting; at 0 it is sparks only. */
  blood(p: THREE.Vector3, dir: THREE.Vector3 | null, head: boolean, ground?: THREE.Vector3) {
    const g = this.gore;
    if (g <= 0.02) { this.burst(p, dir, 6, [0xffffff, 0xb9bdc6], 3, 0.04, 0.25, 8); return; }
    this.burst(p, dir, Math.round((head ? 16 : 9) * g * 1.7), [0x8a0612, 0x5e040c, 0xb00a1c], head ? 4.2 : 3, 0.05, 0.55, 13);
    if (g > 0.3 && ground) for (let i = 0; i < Math.ceil(g * 3); i++) this.decal(v.copy(ground).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2)).clone(), new THREE.Vector3(0, 1, 0), 0.15 + Math.random() * 0.3 * g, 0x3a0308);
  }
  /** Coloured voxel burst for cosmetic kill effects. */
  killEffect(p: THREE.Vector3, color: number) { this.burst(p, new THREE.Vector3(0, 1, 0), 28, [color, 0xffffff], 4, 0.07, 0.9, 5); }
  dust(p: THREE.Vector3, amount = 5) { this.burst(p, new THREE.Vector3(0, 0.4, 0), amount, [0x4a4a50, 0x3a3a3e], 1.4, 0.05, 0.5, -0.4, 0.1); }
  smoke(p: THREE.Vector3) { v.set((Math.random() - 0.5) * 0.3, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.3); this.emit(p, v, 0x2a2a30, 0.25, 3.5, -0.05, 0.35); }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color = 0xffe0a0) {
    const t = this.tracers[this.ti]; this.ti = (this.ti + 1) % MAXT;
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    t.mesh.position.copy(from).lerp(to, 0.5);
    t.mesh.lookAt(to);
    t.mesh.scale.set(0.018, 0.018, len);
    (t.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    t.mesh.visible = true; t.life = 0.09;
  }
  explosion(p: THREE.Vector3, distToCamera: number) {
    this.burst(p, new THREE.Vector3(0, 1, 0), 40, [0xffd28a, 0xff7a2a, 0xff3b1c], 11, 0.16, 0.6, 9);
    this.burst(p, new THREE.Vector3(0, 0.6, 0), 26, [0x1c1c20, 0x2e2e34, 0x45454c], 3.2, 0.45, 2.6, -0.8, 0.5);
    this.burst(p, null, 14, [0x3a1a14, 0x6a2018], 9, 0.09, 1.3, 16); // shrapnel
    this.decal(v.set(p.x, p.y - 0.58, p.z).clone(), new THREE.Vector3(0, 1, 0), 3.2, 0x040404);
    const f = this.flashes.find((x) => x.life <= 0) ?? this.flashes[0];
    f.light.position.copy(p); f.sprite.position.copy(p); f.life = 0.35;
    if (!app.settings.accessibility.reduceShake) this.shake = Math.max(this.shake, Math.max(0, 1 - distToCamera / 30));
  }

  update(dt: number) {
    let any = false;
    for (let i = 0; i < MAXP; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const o = i * 3;
      if (this.life[i] <= 0) { m4.makeScale(0, 0, 0); this.parts.setMatrixAt(i, m4); continue; }
      this.pv[o + 1] -= this.grav[i] * dt;
      this.px[o] += this.pv[o] * dt; this.px[o + 1] += this.pv[o + 1] * dt; this.px[o + 2] += this.pv[o + 2] * dt;
      if (this.grav[i] > 1 && this.px[o + 1] < -4.9) { this.px[o + 1] = -4.9; this.pv[o] = this.pv[o + 1] = this.pv[o + 2] = 0; }
      const k = this.life[i] / this.max[i];
      const s = (this.size[i] + this.grow[i] * (1 - k)) * (this.grow[i] ? 1 : Math.min(1, k * 2.5));
      m4.makeScale(s, s, s); m4.setPosition(this.px[o], this.px[o + 1], this.px[o + 2]);
      this.parts.setMatrixAt(i, m4);
    }
    if (any) this.parts.instanceMatrix.needsUpdate = true;
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.life / 0.09) * 0.9;
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const k = Math.max(0, f.life / 0.35);
      const dim = app.settings.accessibility.reduceFlashes ? 0.3 : 1;
      f.light.intensity = k * 260 * dim; f.sprite.material.opacity = k * dim; f.sprite.scale.setScalar(4 + (1 - k) * 10);
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }
  dispose() { for (const o of [this.parts, this.decals, ...this.tracers.map((t) => t.mesh), ...this.flashes.flatMap((f) => [f.light, f.sprite])]) this.scene.remove(o); }
}
