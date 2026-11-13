// HTTP + realtime transport. VITE_SERVER_URL lets the static client live on a different host than the game server.
import { io, Socket } from 'socket.io-client';
import { app, bus, setUser } from '../state';
import { sanitizeSettings } from '../../../shared/settings';

const SERVER: string = (import.meta.env.VITE_SERVER_URL ?? '').replace(/\/$/, '');
export const musicBase = SERVER + '/music';

export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(SERVER + '/api' + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', ...(app.token ? { Authorization: `Bearer ${app.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && app.token && !path.startsWith('/auth')) { signOut(); throw new Error('Session expired — sign in again'); }
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export let socket: Socket | null = null;
export function connectSocket() {
  socket?.close();
  socket = io(SERVER || undefined, { auth: { token: app.token }, transports: ['websocket', 'polling'] });
  socket.on('online', (n: number) => { app.online = n; bus.emit('online'); });
  socket.on('pg', (t: number) => socket!.emit('pg', t));
  socket.on('party:state', (p) => { app.party = p; bus.emit('party'); });
  socket.on('kicked', (why: string) => { bus.emit('toast', why); signOut(); });
  socket.on('connect_error', (e) => { if (e.message === 'unauthorized') signOut(); });
  for (const ev of ['room:state', 'match:init', 'match:state', 'match:end', 'roster', 'snap', 'ev', 'spawn', 'loadout', 'correct', 'invite', 'party:follow', 'friends:changed', 'room:kicked', 'disconnect', 'connect'])
    socket.on(ev, (m: unknown) => bus.emit('net:' + ev, m));
  return socket;
}
/** Emit with acknowledgement; rejects on { error }. */
export function request<T = any>(ev: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) return reject(new Error('Not connected to the game server'));
    socket.timeout(8000).emit(ev, payload, (err: unknown, res: any) => {
      if (err) return reject(new Error('Server did not respond'));
      if (res?.error) return reject(new Error(res.error));
      resolve(res);
    });
  });
}

export async function signIn(mode: 'login' | 'register', username: string, password: string) {
  const r = await api('/auth/' + mode, { username, password });
  app.token = r.token;
  localStorage.setItem('shootay.token', r.token);
  connectSocket(); // before setUser: the sign-in handlers (invite-link join) need the socket to exist
  setUser(r.user);
}
export function signOut() {
  app.token = null;
  localStorage.removeItem('shootay.token');
  socket?.close(); socket = null;
  setUser(null);
  bus.emit('signedout');
}
export async function refreshMe() { setUser(await api('/me')); }

let saveTimer = 0;
/** Applies settings locally right away and saves them to the account (debounced). */
export function saveSettings() {
  app.settings = sanitizeSettings(app.settings);
  localStorage.setItem('shootay.settings', JSON.stringify(app.settings));
  bus.emit('settings');
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { if (app.token) api('/settings', app.settings, 'PUT').catch(() => {}); }, 600);
}
