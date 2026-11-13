// Local player movement: sprint, jump, crouch and momentum-based sliding (slide-jumps keep their speed).
// Runs on the client for responsiveness; the server sanity-checks every position it is sent.
import { PHYS } from '../../../shared/constants';
import { Collider, V3 } from '../../../shared/physics';
import { Input } from '../engine/input';
import { app } from '../state';

export class PlayerController {
  pos: V3 = [0, 0, 0]; vel: V3 = [0, 0, 0];
  yaw = 0; pitch = 0;
  grounded = false; crouching = false; sliding = false; sprinting = false;
  height = PHYS.height; eye = PHYS.eye;
  private slideT = 0; private slideCd = 0; private stepDist = 0; private airTime = 0;
  onLand: (strength: number) => void = () => {};
  onStep: (loud: number) => void = () => {};
  onJump: () => void = () => {};
  onSlide: () => void = () => {};

  get speed() { return Math.hypot(this.vel[0], this.vel[2]); }
  teleport(p: V3, yaw?: number) { this.pos = [...p] as V3; this.vel = [0, 0, 0]; if (yaw !== undefined) { this.yaw = yaw; this.pitch = 0; } this.sliding = false; this.crouching = false; this.height = PHYS.height; this.eye = PHYS.eye; }

  look(input: Input, zoom: number, adsK: number) {
    const c = app.settings.controls;
    const sens = 0.0021 * c.sensitivity * (1 + (c.adsSensitivity / Math.max(1, zoom * 0.8) - 1) * adsK);
    this.yaw -= input.lookDX * sens;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - input.lookDY * sens * (c.invertY ? -1 : 1)));
  }

  update(dt: number, input: Input, col: Collider, moveMul: number, ads: boolean) {
    const P = PHYS;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let wx = fx * input.moveZ + rx * input.moveX, wz = fz * input.moveZ + rz * input.moveX;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const movingFwd = input.moveZ > 0.3;
    this.slideCd = Math.max(0, this.slideCd - dt);
    const sp = this.speed;

    // ── slide: needs sprint speed; converts it into a burst that decays with friction ──
    if (input.crouchTap && this.grounded && !this.sliding && this.slideCd <= 0 && sp > P.walk * 1.08) {
      this.sliding = true; this.slideT = 0;
      const boost = Math.max(sp * P.slideBoost, P.slideMin);
      const dx = sp > 0.1 ? this.vel[0] / sp : fx, dz = sp > 0.1 ? this.vel[2] / sp : fz;
      this.vel[0] = dx * boost; this.vel[2] = dz * boost;
      this.onSlide();
    }
    const wantCrouch = input.crouch || this.sliding;
    if (wantCrouch) this.crouching = true;
    else if (this.crouching && !col.overlaps(this.pos[0], this.pos[1] + 0.02, this.pos[2], P.height)) this.crouching = false; // need headroom to stand
    this.sprinting = input.sprint && movingFwd && !this.crouching && !ads && this.grounded;

    if (this.sliding) {
      this.slideT += dt;
      const s = this.speed, ns = Math.max(0, s - P.slideFriction * dt);
      if (s > 0.01) { this.vel[0] *= ns / s; this.vel[2] *= ns / s; }
      // gentle steering so slides can curve around cover
      this.vel[0] += wx * 6 * dt; this.vel[2] += wz * 6 * dt;
      const s2 = this.speed; if (s2 > ns && s2 > 0) { this.vel[0] *= ns / s2; this.vel[2] *= ns / s2; }
      if (ns < P.slideEnd || this.slideT > P.slideMax || !this.grounded && this.slideT > 0.1) { this.sliding = false; this.slideCd = P.slideCooldown; }
    } else if (this.grounded) {
      const max = (this.crouching ? P.crouch : this.sprinting ? P.sprint : P.walk) * moveMul * (ads ? P.adsMul : 1);
      const tx = wx * max, tz = wz * max;
      const ax = tx - this.vel[0], az = tz - this.vel[2], al = Math.hypot(ax, az);
      // above normal speed (after a slide-jump landing) momentum bleeds off through friction instead of snapping
      const rate = (sp > max + 0.5 ? P.friction * 1.6 : P.accel) * dt;
      if (al <= rate || al === 0) { this.vel[0] = tx; this.vel[2] = tz; } else { this.vel[0] += (ax / al) * rate; this.vel[2] += (az / al) * rate; }
    } else {
      // air control: can redirect, cannot exceed current speed by much
      const max = Math.max(P.walk * moveMul, sp);
      this.vel[0] += wx * P.airAccel * dt; this.vel[2] += wz * P.airAccel * dt;
      const s = this.speed; if (s > max) { this.vel[0] *= max / s; this.vel[2] *= max / s; }
    }
    if (input.jump && this.grounded) {
      this.vel[1] = P.jump; this.grounded = false;
      if (this.sliding) { this.sliding = false; this.slideCd = P.slideCooldown; } // slide-jump: horizontal momentum is kept
      if (!input.crouch) this.crouching = false;
      this.onJump();
    }
    this.vel[1] -= P.gravity * dt;

    const targetH = this.crouching ? P.crouchHeight : P.height;
    this.height = targetH; // collision height switches instantly; the camera eases below
    const fall = this.vel[1], wasGround = this.grounded;
    const res = col.move(this.pos, this.vel, dt, this.height, this.grounded);
    this.grounded = res.ground;
    if (!this.grounded) this.airTime += dt;
    if (this.grounded && !wasGround) { if (this.airTime > 0.18) this.onLand(Math.min(1, -fall / 12)); this.airTime = 0; if (input.crouch && this.speed > P.walk * 1.2 && this.slideCd <= 0) input.crouchTap = true; }
    if (this.grounded && wasGround) this.airTime = 0;
    const eyeT = this.crouching ? P.crouchEye : P.eye;
    this.eye += (eyeT - this.eye) * Math.min(1, dt * 14);

    if (this.grounded && !this.sliding) {
      this.stepDist += this.speed * dt;
      const stride = this.sprinting ? 2.5 : 2.0;
      if (this.stepDist > stride) { this.stepDist = 0; this.onStep(this.crouching ? 0.35 : this.sprinting ? 1 : 0.7); }
    }
    if (this.pos[1] < -30) this.vel = [0, 0, 0]; // fell out of the world: wait for the server correction
  }
}
