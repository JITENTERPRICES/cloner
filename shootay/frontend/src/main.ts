// Entry point: owns the renderer and the top-level flow  auth -> lobby -> (room) -> match -> results -> lobby.
import * as THREE from 'three';
import './styles.css';
import { music, startAmbience, stopAmbience, unlockAudio } from './engine/audio';
import { Input } from './engine/input';
import { Match, MatchInit } from './game/match';
import { api, connectSocket, refreshMe, request, signOut, socket } from './net/net';
import { app, bus } from './state';
import { h, toast } from './ui/dom';
import { Lobby3D } from './ui/lobby3d';
import { hidePause, hideResults, showPause, showResults } from './ui/matchui';
import { stopSearching } from './ui/panels/play';
import { Shell } from './ui/shell';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !app.touch, powerPreference: 'high-performance', stencil: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;

function applyGraphics() {
  const g = app.settings.graphics;
  // lower tiers cap the device pixel ratio: the single biggest win on phone GPUs
  const cap = g.quality === 'low' ? 1 : g.quality === 'medium' ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, cap) * g.resolution);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = g.shadows && g.quality !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}
applyGraphics();
addEventListener('resize', applyGraphics);
addEventListener('orientationchange', () => setTimeout(applyGraphics, 200));

const input = new Input(canvas);
const lobby = new Lobby3D(canvas);
const shell = new Shell(lobby);
let match: Match | null = null;
(window as any).__shootay = { get match() { return match; }, app, input }; // debugging / automated tests

bus.on('settings', () => { applyGraphics(); match?.applySettings(); });
addEventListener('pointerdown', unlockAudio, { passive: true });
addEventListener('keydown', unlockAudio);

function toLobby() {
  hidePause(); hideResults(); stopSearching();
  if (match) { match.dispose(); match = null; }
  if (!app.user) return;
  shell.showLobby();
  startAmbience('lobby');
  refreshMe().catch(() => {});
}
function leaveMatch() {
  socket?.emit('room:leave');
  shell.clearRoom();
  toLobby();
}

bus.on('net:match:init', (init: MatchInit) => {
  stopSearching(); hidePause(); hideResults();
  match?.dispose();
  shell.hide();
  stopAmbience();
  match = new Match(input, init);
  if (!app.touch) input.lock();
});
bus.on('net:match:end', (end: any) => {
  if (!match) return;
  hidePause();
  showResults(end, match.init.isPrivate, leaveMatch);
  if (end.reward) refreshMe().catch(() => {});
});
// a private room went back to its lobby after the match
bus.on('net:room:state', () => { if (match) { hideResults(); toLobby(); } });
bus.on('net:room:kicked', () => { if (match) toLobby(); });
bus.on('pause', () => {
  if (!match || match.ended || document.getElementById('pause')) return;
  match.setPaused(true); input.unlock();
  showPause(() => { hidePause(); match?.setPaused(false); if (!app.touch) input.lock(); }, leaveMatch);
});
bus.on('net:disconnect', () => { if (app.user) { toast('Connection to the game server lost — reconnecting…', 'error'); if (match) { shell.clearRoom(); toLobby(); } } });

// touch layout editor (Settings > Mobile)
bus.on('touch:edit', () => {
  input.setEditing(true);
  const bar = h('div.edit-bar', null, h('span', null, 'Drag each button where you want it'), h('button.btn.primary', { onclick: () => { input.setEditing(false); bar.remove(); } }, 'Done'));
  document.body.append(bar);
});

// sign-in state drives everything else
let signedIn = false;
bus.on('user', () => {
  if (app.user && !signedIn) {
    signedIn = true;
    lobby.setOutfit(app.user.outfit); lobby.refreshWeapon();
    toLobby();
    music.load();
    api('/catalog/extra').then((x) => (app.extraClothing = x)).catch(() => {});
    // invite link: /join/ROOMCODE -> join that room as soon as the socket is up
    if (app.pendingJoin) {
      const code = app.pendingJoin; app.pendingJoin = null;
      history.replaceState(null, '', '/');
      const tryJoin = () => request('room:join', { code }).catch((e) => toast(`Could not join room ${code}: ${e.message}`, 'error'));
      if (socket?.connected) tryJoin(); else socket?.once('connect', tryJoin);
    }
  }
});
bus.on('signedout', () => { signedIn = false; if (match) { match.dispose(); match = null; } hidePause(); hideResults(); stopAmbience(); music.pause(); shell.showAuth(); });

(async () => {
  if (app.token) {
    try { connectSocket(); await refreshMe(); return; } catch { signOut(); return; }
  }
  shell.showAuth();
})();

// main loop
let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (match) { match.update(dt); match.render(renderer); }
  else { lobby.update(dt); lobby.render(renderer); }
}
requestAnimationFrame(frame);
