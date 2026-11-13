// Player settings: defaults + a sanitiser used by the server before anything is stored.
import { DEFAULT_GORE } from './constants';

export const DEFAULT_SETTINGS = {
  graphics: { quality: 'medium' as 'low' | 'medium' | 'high', shadows: false, resolution: 1, particles: 1, fov: 80, viewDistance: 1 },
  audio: { master: 0.8, sfx: 0.9, music: 0.5, ambience: 0.6, musicMuted: false, shuffle: false, repeat: 'all' as 'off' | 'all' | 'one', track: 0 },
  controls: { sensitivity: 1, adsSensitivity: 0.7, touchSensitivity: 1, invertY: false, adsToggle: false, crouchToggle: false, autoSprint: true },
  touch: { scale: 1, opacity: 0.55, leftHanded: false, autoFire: false, positions: {} as Record<string, [number, number]> },
  crosshair: { style: 'cross' as 'cross' | 'dot' | 'circle' | 'none', color: '#e8e8ee', size: 8, gap: 5, thickness: 2, dot: true, dynamic: true },
  hud: { scale: 1, opacity: 1, killfeed: true, hitmarkers: true, damageNumbers: false, fps: false },
  accessibility: { enemyColor: '#ff3b4e', reduceShake: false, reduceFlashes: false, largeText: false, highContrastHud: false },
  gore: DEFAULT_GORE,
  privacy: { publicProfile: true, friendRequests: true, invites: true, showOnline: true },
};
export type Settings = typeof DEFAULT_SETTINGS;

/** Deep-merges `input` onto the defaults, keeping only known keys of the right type and range. */
export function sanitizeSettings(input: unknown): Settings {
  const walk = (def: any, inp: any, path: string): any => {
    if (def !== null && typeof def === 'object' && !Array.isArray(def)) {
      if (path === 'touch.positions') {
        const out: Record<string, [number, number]> = {};
        if (inp && typeof inp === 'object') for (const k of Object.keys(inp).slice(0, 16)) {
          const v = inp[k];
          if (/^[a-z]{2,12}$/.test(k) && Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n))) out[k] = [clamp(v[0], 0, 100), clamp(v[1], 0, 100)];
        }
        return out;
      }
      const out: any = {};
      for (const k of Object.keys(def)) out[k] = walk(def[k], inp && typeof inp === 'object' ? inp[k] : undefined, path ? `${path}.${k}` : k);
      return out;
    }
    if (typeof def === 'number') return typeof inp === 'number' && Number.isFinite(inp) ? clamp(inp, RANGE[path]?.[0] ?? 0, RANGE[path]?.[1] ?? 1) : def;
    if (typeof def === 'boolean') return typeof inp === 'boolean' ? inp : def;
    if (typeof def === 'string') {
      if (ENUM[path]) return ENUM[path].includes(inp) ? inp : def;
      return typeof inp === 'string' && /^#[0-9a-fA-F]{6}$/.test(inp) ? inp : def;
    }
    return def;
  };
  return walk(DEFAULT_SETTINGS, input, '');
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const RANGE: Record<string, [number, number]> = {
  'graphics.resolution': [0.4, 1], 'graphics.particles': [0, 1], 'graphics.fov': [60, 110], 'graphics.viewDistance': [0.5, 1],
  'controls.sensitivity': [0.1, 4], 'controls.adsSensitivity': [0.1, 2], 'controls.touchSensitivity': [0.1, 4],
  'touch.scale': [0.6, 1.6], 'touch.opacity': [0.15, 1], 'crosshair.size': [2, 30], 'crosshair.gap': [0, 20], 'crosshair.thickness': [1, 6],
  'hud.scale': [0.7, 1.4], 'hud.opacity': [0.3, 1], 'audio.track': [0, 3],
};
const ENUM: Record<string, string[]> = {
  'graphics.quality': ['low', 'medium', 'high'], 'audio.repeat': ['off', 'all', 'one'], 'crosshair.style': ['cross', 'dot', 'circle', 'none'],
};
