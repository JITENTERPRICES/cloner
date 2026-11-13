// First-person weapon: its own scene/camera drawn over the world (never clips into walls).
// All animation is procedural: sway, bob, recoil, ADS, reload, switch, inspect, sprint, slide and landing.
import * as THREE from 'three';
import { WeaponStats } from '../../../shared/attachments';
import { GunModel, buildGun } from './guns';

const HIP = new THREE.Vector3(0.15, -0.16, -0.46);
const spring = (cur: number, target: number, k: number, dt: number) => cur + (target - cur) * Math.min(1, k * dt);

export class ViewModel {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
  private rig = new THREE.Group();
  private gun: GunModel | null = null;
  private armR: THREE.Mesh; private armL: THREE.Mesh;
  private flash: THREE.Mesh; private flashLight: THREE.PointLight;
  stats: WeaponStats | null = null;
  ads = 0; // 0..1
  private kick = 0; private kickRot = 0; private swayX = 0; private swayY = 0; private bobT = 0; private land = 0; private sprintK = 0; private slideK = 0;
  private reloadT = -1; private reloadDur = 1; private switchT = -1; private pending: (() => void) | null = null; private inspectT = -1; private flashT = 0;
  private magHome = new THREE.Vector3();
  private sleeve = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.9 });
  private glove = new THREE.MeshStandardMaterial({ color: 0x8d5a3c, roughness: 0.8 });

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xd8d4f0, 0x5a5060, 4));
    const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(-1, 2, 1.5); this.scene.add(key);
    this.scene.add(this.rig);
    const g = new THREE.BoxGeometry(1, 1, 1);
    const mkArm = () => { const a = new THREE.Mesh(g, this.sleeve); const hand = new THREE.Mesh(g, this.glove); hand.scale.set(1.02, 1.02, 0.22); hand.position.z = -0.52; a.add(hand); this.rig.add(a); return a; };
    this.armR = mkArm(); this.armL = mkArm();
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.flashLight = new THREE.PointLight(0xffb060, 0, 3);
    this.rig.add(this.flash, this.flashLight);
  }
  setArms(sleeve: number, hand: number) { this.sleeve.color.setHex(sleeve); this.glove.color.setHex(hand); }

  get busy() { return this.reloadT >= 0 || this.switchT >= 0; }
  get reloading() { return this.reloadT >= 0; }
  get zoomOptic() { return !!this.gun?.userData.zoomOptic; }

  /** Lowers the current weapon, swaps the model at the bottom of the motion, raises the new one. */
  equip(weapon: string, atts: string[], skin: string | null, stats: WeaponStats, instant = false) {
    const swap = () => {
      if (this.gun) this.rig.remove(this.gun);
      this.gun = buildGun(weapon, atts, skin);
      this.rig.add(this.gun);
      this.stats = stats;
      this.magHome.copy(this.gun.userData.mag.position);
      const u = this.gun.userData;
      this.armR.scale.set(0.055, 0.06, 0.46); this.armR.position.set(0.05, -0.17, u.gripZ + 0.22); this.armR.rotation.set(0.5, -0.16, 0);
      this.armL.scale.set(0.055, 0.06, 0.5); this.armL.position.set(-0.1, -0.13, u.foreZ + 0.2); this.armL.rotation.set(0.42, -0.45, 0.2);
      this.armL.visible = stats.cat !== 'pistol' || true;
      if (stats.cat === 'pistol') { this.armL.position.set(-0.07, -0.16, 0.21); this.armL.rotation.set(0.5, -0.36, 0.2); }
    };
    this.reloadT = -1; this.inspectT = -1;
    if (instant || !this.gun) { swap(); this.switchT = 0.5; this.pending = null; }
    else { this.switchT = 0; this.pending = swap; }
  }
  fire() {
    if (!this.stats) return;
    const heavy = this.stats.cat === 'sniper' || this.stats.cat === 'shotgun' ? 2.2 : this.stats.cat === 'pistol' ? 1.3 : 1;
    this.kick = Math.min(0.09, this.kick + 0.022 * heavy);
    this.kickRot = Math.min(0.3, this.kickRot + 0.035 * heavy);
    this.flashT = this.stats.silent ? 0 : 0.05;
    this.inspectT = -1;
    this.flash.rotation.z = Math.random() * 6.28;
  }
  reload(duration: number) { this.reloadT = 0; this.reloadDur = duration; this.inspectT = -1; }
  cancelReload() { this.reloadT = -1; }
  inspect() { if (!this.busy) this.inspectT = 0; }
  landed(strength: number) { this.land = Math.min(1, strength); }

  update(dt: number, s: { lookDX: number; lookDY: number; speed: number; grounded: boolean; sprinting: boolean; sliding: boolean; wantAds: boolean; aspect: number }) {
    const g = this.gun, st = this.stats;
    if (!g || !st) return;
    this.camera.aspect = s.aspect; this.camera.updateProjectionMatrix();
    const canAds = s.wantAds && !this.reloading && this.switchT < 0 && !s.sprinting && this.inspectT < 0;
    this.ads = Math.max(0, Math.min(1, this.ads + (canAds ? dt : -dt) / st.adsTime));
    const a = this.ads * this.ads * (3 - 2 * this.ads);
    this.sprintK = spring(this.sprintK, s.sprinting && !s.sliding && s.grounded ? 1 : 0, 9, dt);
    this.slideK = spring(this.slideK, s.sliding ? 1 : 0, 10, dt);
    this.kick = spring(this.kick, 0, 14, dt); this.kickRot = spring(this.kickRot, 0, 12, dt);
    this.land = spring(this.land, 0, 7, dt);
    // weapon sway lags behind the camera turn
    this.swayX = spring(this.swayX, THREE.MathUtils.clamp(-s.lookDX * 0.0016, -0.06, 0.06), 9, dt);
    this.swayY = spring(this.swayY, THREE.MathUtils.clamp(s.lookDY * 0.0016, -0.05, 0.05), 9, dt);
    this.bobT += dt * (s.grounded ? Math.min(s.speed, 9) : 0) * 1.5;
    const bobAmp = (s.grounded ? Math.min(1, s.speed / 6) : 0) * (1 - a * 0.85) * (1 - this.slideK);
    const bx = Math.cos(this.bobT) * 0.012 * bobAmp, by = Math.abs(Math.sin(this.bobT)) * 0.012 * bobAmp;

    const r = this.rig;
    // ADS lines the sight up with the screen centre; hip pose sits low right
    const adsPos = new THREE.Vector3(0, -g.userData.sightY, st.cat === 'pistol' ? -0.4 : -0.24);
    r.position.lerpVectors(HIP, adsPos, a);
    r.position.x += bx + this.swayX * (1 - a * 0.7) + this.slideK * 0.03;
    r.position.y += -by + this.swayY * (1 - a * 0.7) - this.land * 0.05 - this.sprintK * 0.03 - this.slideK * 0.02;
    r.position.z += this.kick;
    r.rotation.set(this.kickRot * (1 - a * 0.55) - this.land * 0.12 - this.sprintK * 0.25, this.swayX * 1.5 + this.sprintK * 0.75, this.swayX * -1.2 + this.slideK * 0.4 + bx * 2);

    // weapon switch: dip below the screen
    if (this.switchT >= 0) {
      this.switchT += dt;
      const k = this.switchT / 0.25; // 0..1 lower, 1..2 raise
      if (k >= 1 && this.pending) { this.pending(); this.pending = null; }
      const dip = k < 1 ? k : Math.max(0, 2 - k);
      r.position.y -= dip * 0.3; r.rotation.x -= dip * 0.9;
      if (k >= 2) this.switchT = -1;
    }
    // reload: tilt, drop the mag, seat a fresh one, rack
    const mag = g.userData.mag, bolt = g.userData.bolt;
    mag.position.copy(this.magHome);
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      const k = this.reloadT / this.reloadDur;
      const tilt = Math.sin(Math.min(1, k / 0.15) * Math.PI / 2) * (k > 0.85 ? Math.max(0, (1 - k) / 0.15) : 1);
      r.rotation.z += tilt * 0.45; r.rotation.x += tilt * 0.22; r.position.y -= tilt * 0.03;
      const out = k < 0.2 ? 0 : k < 0.4 ? (k - 0.2) / 0.2 : k < 0.55 ? 1 : k < 0.72 ? 1 - (k - 0.55) / 0.17 : 0;
      mag.position.y -= out * 0.28; mag.position.z += out * 0.05;
      mag.visible = !(k > 0.4 && k < 0.55);
      const rack = k > 0.78 && k < 0.92 ? Math.sin(((k - 0.78) / 0.14) * Math.PI) : 0;
      bolt.position.z = -0.02 + rack * 0.05;
      this.armL.position.y = (st.cat === 'pistol' ? -0.16 : -0.13) - out * 0.25;
      if (k >= 1) { this.reloadT = -1; mag.visible = true; }
    } else { mag.visible = true; bolt.position.z = -0.02 + this.kick * 0.5; this.armL.position.y = st.cat === 'pistol' ? -0.16 : -0.13; }
    // inspect: roll the weapon to show both sides
    if (this.inspectT >= 0) {
      this.inspectT += dt;
      const k = this.inspectT / 3;
      const e = Math.sin(Math.min(1, k) * Math.PI), flip = Math.sin(Math.min(1, k) * Math.PI * 2);
      r.rotation.z += e * 0.9 + flip * 0.5; r.rotation.y += e * 0.7; r.position.x -= e * 0.06; r.position.y += e * 0.05;
      if (k >= 1) this.inspectT = -1;
    }
    // muzzle flash
    this.flashT = Math.max(0, this.flashT - dt);
    const fm = this.flash.material as THREE.MeshBasicMaterial;
    fm.opacity = this.flashT > 0 ? 0.95 : 0;
    this.flash.position.copy(g.userData.muzzle.position).add(new THREE.Vector3(0, 0, -0.06));
    this.flash.scale.setScalar(st.cat === 'shotgun' || st.cat === 'sniper' ? 1.5 : 1);
    this.flashLight.position.copy(this.flash.position);
    this.flashLight.intensity = this.flashT > 0 ? 2 : 0;
  }
  /** Muzzle position in world space, given the main camera (for tracer origins). */
  muzzleWorld(mainCam: THREE.Camera, out: THREE.Vector3) {
    if (!this.gun) return out.copy(mainCam.position);
    this.gun.userData.muzzle.getWorldPosition(out); // viewmodel space == camera-local space
    return out.applyMatrix4(mainCam.matrixWorld);
  }
}
