// Client-side app state + a tiny event bus. Nothing here is trusted by the server.
import { ClothingDef, Outfit } from '../../shared/clothing';
import { DEFAULT_SETTINGS, Settings, sanitizeSettings } from '../../shared/settings';

export interface LoadoutSlot { weapon: string; atts: string[]; skin: string | null }
export interface Me {
  id: string; username: string; deyes: number; xp: number; level: number;
  stats: { kills: number; deaths: number; headshots: number; wins: number; matches: number };
  loadout: { primary: LoadoutSlot; secondary: LoadoutSlot }; outfit: Outfit; fx: { tracer: string | null; kill: string | null };
  settings: Settings; inventory: Record<'weapon' | 'attachment' | 'clothing' | 'skin' | 'effect', string[]>;
}
export interface PartyState { id: string; leader: string; members: { id: string; name: string }[] }

const stored = (() => { try { return JSON.parse(localStorage.getItem('shootay.settings') ?? 'null'); } catch { return null; } })();
export const app = {
  user: null as Me | null,
  token: localStorage.getItem('shootay.token'),
  settings: sanitizeSettings(stored ?? DEFAULT_SETTINGS),
  online: 0,
  party: null as PartyState | null,
  extraClothing: [] as ClothingDef[],
  /** Room code from a /join/CODE invite link, consumed after sign-in. */
  pendingJoin: (location.pathname.match(/^\/join\/([A-Za-z0-9]{6})\/?$/)?.[1] ?? null)?.toUpperCase() ?? null,
  touch: matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window,
};

type Fn = (...a: any[]) => void;
const listeners = new Map<string, Set<Fn>>();
export const bus = {
  on(ev: string, fn: Fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev)!.add(fn); return () => listeners.get(ev)!.delete(fn); },
  emit(ev: string, ...a: any[]) { listeners.get(ev)?.forEach((fn) => fn(...a)); },
};

export function setUser(u: Me | null) {
  app.user = u;
  if (u) { app.settings = sanitizeSettings(u.settings); localStorage.setItem('shootay.settings', JSON.stringify(app.settings)); }
  bus.emit('user');
  bus.emit('settings');
}
export function setDeyes(n: number) { if (app.user) { app.user.deyes = n; bus.emit('user'); } }
