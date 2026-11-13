// The 3D lobby: your operator on a rooftop at night. Drag to rotate; panels re-dress the character
// or swap in a weapon for inspection.
import * as THREE from 'three';
import { RARITY_COLOR, Rarity } from '../../../shared/constants';
import { Outfit } from '../../../shared/clothing';
import { Avatar } from '../engine/avatar';
import { GunModel, buildGun } from '../engine/guns';
import { buildSky, glowTexture, worldMaterial } from '../engine/world';
import { app } from '../state';

export class Lobby3D {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
  avatar: Avatar;
  private pivot = new THREE.Group();
  private gunPivot = new THREE.Group();
  private previewGun: GunModel | null = null;
  private rarityLight = new THREE.PointLight(0xa24bff, 0, 6);
  private fan: THREE.Mesh; private beacon: THREE.Sprite; private smoke: THREE.Sprite[] = []; private sign: THREE.Mesh;
  private t = 0; private yaw = 0.35; private targetYaw = 0.35; private gunYaw = 0.6; private gunPitch = 0.1; private dragging = false; private idle = 0;
  private mode: 'character' | 'weapon' = 'character';
  /** 0 = centred, 1 = shifted left to make room for a side panel */
  shift = 0; private shiftK = 0; private zoom = 0; private zoomK = 0; private flash = 0;

  constructor(canvas: HTMLCanvasElement) {
    const s = this.scene, low = app.settings.graphics.quality === 'low';
    s.fog = new THREE.FogExp2(0x0b0814, 0.012);
    s.background = new THREE.Color(0x0b0814);
    buildSky(s, 0x05030a, 0x26123c);
    const add = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.receiveShadow = true; s.add(b); return b; };
    const conc = worldMaterial('concrete', low).clone() as THREE.MeshStandardMaterial; (conc as any).vertexColors = false; conc.map = conc.map!.clone(); conc.map.repeat.set(6, 6); conc.map.needsUpdate = true;
    const metal = worldMaterial('metal', low).clone() as THREE.MeshStandardMaterial; (metal as any).vertexColors = false;
    const dark = new THREE.MeshStandardMaterial({ color: 0x121216, roughness: 0.7, metalness: 0.4 });
    add(conc, 26, 1, 22, 0, -0.5, -4); // roof deck
    add(dark, 26, 1.0, 0.5, 0, 0.5, -15); add(dark, 0.5, 1.0, 22, -13, 0.5, -4); add(dark, 0.5, 1.0, 22, 13, 0.5, -4); // parapet
    add(metal, 2.6, 1.6, 1.8, -5, 0.8, -6); add(metal, 1.6, 1.1, 1.6, 5.2, 0.55, -4.5); // AC units
    add(dark, 0.3, 4.6, 0.3, 7.6, 2.3, -11); add(dark, 3.4, 0.2, 0.2, 7.6, 4.2, -11); // antenna mast
    add(metal, 3, 3.4, 3, -8.5, 2.7, -11); add(dark, 0.25, 1.0, 0.25, -9.6, 0.5, -12.1); add(dark, 0.25, 1.0, 0.25, -7.4, 0.5, -9.9); // water tank
    add(dark, 1.2, 0.5, 1.2, 3.2, 0.25, -9); // vent
    this.fan = add(new THREE.MeshStandardMaterial({ color: 0x3a3c42, metalness: 0.8, roughness: 0.4 }), 1.5, 0.06, 0.22, -5, 1.64, -6);
    const fan2 = new THREE.Mesh(this.fan.geometry, this.fan.material); fan2.rotation.y = Math.PI / 2; this.fan.add(fan2);
    // neon wordmark
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d')!;
    g.fillStyle = '#07060a'; g.fillRect(0, 0, 512, 128);
    g.font = '900 88px "Arial Black", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = '#b04dff'; g.shadowBlur = 24; g.fillStyle = '#e9d9ff'; g.fillText('SHOOTAY', 256, 68);
    this.sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.75), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), fog: false }));
    this.sign.position.set(0, 3.3, -14.6); s.add(this.sign);
    add(dark, 0.2, 2.6, 0.2, -3, 1.3, -14.8); add(dark, 0.2, 2.6, 0.2, 3, 1.3, -14.8);
    this.beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff2d45, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.beacon.position.set(7.6, 4.8, -11); this.beacon.scale.setScalar(1.4); s.add(this.beacon);
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x6a6478, transparent: true, opacity: 0.12, depthWrite: false }));
      sp.userData.o = i / 10; s.add(sp); this.smoke.push(sp);
    }
    // cinematic three-point lighting in the brand palette
    s.add(new THREE.HemisphereLight(0x8f86d0, 0x1a1218, 1.5));
    const key = new THREE.SpotLight(0xfff0e0, 60, 20, 0.5, 0.6, 1.2); key.position.set(2.5, 5, 4.5); key.target.position.set(0, 1, 0); key.castShadow = !low; key.shadow.mapSize.set(1024, 1024); s.add(key, key.target);
    const rimP = new THREE.PointLight(0xb04dff, 40, 14); rimP.position.set(-3.2, 2.6, -2.4); s.add(rimP);
    const rimR = new THREE.PointLight(0xff2d45, 26, 12); rimR.position.set(3.4, 1.4, -2.6); s.add(rimR);
    const signL = new THREE.PointLight(0xb04dff, 30, 16); signL.position.set(0, 3.2, -13); s.add(signL);
    s.add(this.rarityLight);

    this.avatar = new Avatar(app.user?.outfit ?? { operator: 'op_kade' });
    this.pivot.add(this.avatar.root); s.add(this.pivot);
    this.gunPivot.position.set(0, 1.35, 0.6); this.gunPivot.visible = false; s.add(this.gunPivot);
    this.refreshWeapon();

    // drag to rotate the character / inspected weapon
    let lastX = 0, lastY = 0;
    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; lastX = e.clientX; lastY = e.clientY; this.idle = 0; });
    addEventListener('pointerup', () => (this.dragging = false));
    addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
      if (this.mode === 'weapon') { this.gunYaw += dx * 0.01; this.gunPitch = THREE.MathUtils.clamp(this.gunPitch + dy * 0.008, -0.9, 0.9); }
      else this.targetYaw += dx * 0.01;
    });
    canvas.addEventListener('wheel', (e) => { this.zoom = THREE.MathUtils.clamp(this.zoom - e.deltaY * 0.001, 0, 1); }, { passive: true });
  }

  setOutfit(o: Outfit) { this.avatar.setOutfit(o); }
  /** Puts the equipped primary (or a specific build) in the operator's hands. */
  refreshWeapon(slot?: { weapon: string; atts: string[]; skin: string | null }) {
    const s = slot ?? app.user?.loadout.primary ?? { weapon: 'mr4', atts: [], skin: null };
    this.avatar.setGun(buildGun(s.weapon, s.atts, s.skin));
  }
  inspectHeld() { this.avatar.inspect(); }
  /** Shows a weapon build on its own for the gunsmith; rarity tints the inspection light. */
  showWeapon(weapon: string, atts: string[], skin: string | null, rarity: Rarity) {
    if (this.previewGun) this.gunPivot.remove(this.previewGun);
    this.previewGun = buildGun(weapon, atts, skin);
    const len = this.previewGun.userData.length;
    this.previewGun.scale.setScalar(Math.min(3.2, 1.9 / Math.max(0.3, len)));
    // centre the model on its length so it spins in place
    const box = new THREE.Box3().setFromObject(this.previewGun), ctr = box.getCenter(new THREE.Vector3());
    this.previewGun.position.sub(ctr);
    this.gunPivot.add(this.previewGun);
    this.mode = 'weapon'; this.gunPivot.visible = true; this.pivot.visible = false;
    this.rarityLight.color.set(RARITY_COLOR[rarity]); this.rarityLight.intensity = 14;
    this.flash = 1;
  }
  showCharacter() { this.mode = 'character'; this.gunPivot.visible = false; this.pivot.visible = true; this.rarityLight.intensity = 0; }
  /** Rarity-coloured pulse (mystery box reveals). */
  pulse(rarity: Rarity) { this.rarityLight.color.set(RARITY_COLOR[rarity]); this.flash = 1.6; }
  face(yaw: number) { this.targetYaw = yaw; }

  update(dt: number) {
    this.t += dt; this.idle += dt;
    const portrait = innerWidth < innerHeight * 0.9;
    this.shiftK += ((portrait ? 0 : this.shift) - this.shiftK) * Math.min(1, dt * 5);
    this.zoomK += (this.zoom - this.zoomK) * Math.min(1, dt * 6);
    if (!this.dragging && this.mode === 'weapon') this.gunYaw += dt * 0.5;
    this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 8);
    this.pivot.rotation.y = this.yaw + Math.PI; // the model faces -Z; turn it toward the camera
    this.gunPivot.rotation.set(this.gunPitch, this.gunYaw, 0);
    this.avatar.update(dt, { speed: 0, crouch: false, slide: false, air: false, pitch: Math.sin(this.t * 0.5) * 0.04, pose: 'ready' });
    if (this.idle > 14 && this.mode === 'character') { this.idle = 0; this.avatar.inspect(); } // idle weapon check

    const weapon = this.mode === 'weapon';
    const dist = (weapon ? 3.4 : portrait ? 6.2 : 4.6) - this.zoomK * (weapon ? 1.4 : 2.2);
    const lookY = weapon ? 1.35 : 1.0 + this.zoomK * 0.45;
    const side = this.shiftK * 0.2 * 2 * dist * Math.tan((38 * Math.PI) / 360) * (innerWidth / innerHeight); // centre of the area left of the panel
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.camera.position.set(side + Math.sin(this.t * 0.2) * 0.06, lookY + 0.35 + Math.sin(this.t * 0.27) * 0.03, dist + (weapon ? 0.6 : 0));
    this.camera.lookAt(side, lookY, weapon ? 0.6 : 0);

    this.fan.rotation.y += dt * 5;
    (this.beacon.material as THREE.SpriteMaterial).opacity = 0.35 + 0.65 * Math.max(0, Math.sin(this.t * 2.4));
    for (const sp of this.smoke) {
      const k = (this.t * 0.07 + sp.userData.o) % 1;
      sp.position.set(3.2 + Math.sin(k * 9 + sp.userData.o * 20) * 0.5 + k * 1.5, 0.6 + k * 6, -9 + Math.cos(k * 7) * 0.4);
      sp.scale.setScalar(0.8 + k * 3.2); (sp.material as THREE.SpriteMaterial).opacity = 0.16 * (1 - k);
    }
    ((this.sign.material as THREE.MeshBasicMaterial).color as THREE.Color).setScalar(Math.sin(this.t * 31) > 0.985 ? 0.55 : 1); // neon flicker
    this.flash = Math.max(0, this.flash - dt * 1.5);
    if (weapon) { this.rarityLight.position.set(1.2, 2.0, 1.6); this.rarityLight.intensity = 14 + this.flash * 40; }
    else { this.rarityLight.position.set(0, 1.4, 1.5); this.rarityLight.intensity = this.flash * 60; }
  }
  render(r: THREE.WebGLRenderer) { r.autoClear = true; r.render(this.scene, this.camera); }
}
