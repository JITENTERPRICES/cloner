// Settings. Every control writes straight into app.settings, applies immediately and saves to the account.
import { DEFAULT_SETTINGS } from '../../../../shared/settings';
import { music } from '../../engine/audio';
import { saveSettings, signOut } from '../../net/net';
import { app, bus } from '../../state';
import { clear, h } from '../dom';

const get = (path: string) => path.split('.').reduce((o: any, k) => o[k], app.settings);
const set = (path: string, v: unknown) => { const ks = path.split('.'), last = ks.pop()!; ks.reduce((o: any, k) => o[k], app.settings)[last] = v; saveSettings(); };

const slider = (label: string, path: string, min: number, max: number, step: number, fmt: (v: number) => string = (v) => String(v)) => {
  const out = h('output', null, fmt(get(path)));
  return h('label.ctl', null, h('span', null, label), h('input', { type: 'range', min, max, step, value: get(path), oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); out.textContent = fmt(v); set(path, v); } }), out);
};
const toggle = (label: string, path: string, hint?: string) => h('label.ctl.check', null, h('input', { type: 'checkbox', checked: get(path), onchange: (e: Event) => set(path, (e.target as HTMLInputElement).checked) }), h('span', null, label, hint ? h('small', null, hint) : null));
const select = (label: string, path: string, opts: [string, string][]) => h('label.ctl', null, h('span', null, label), h('select', { onchange: (e: Event) => set(path, (e.target as HTMLSelectElement).value) }, opts.map(([v, t]) => h('option', { value: v, selected: get(path) === v }, t))));
const color = (label: string, path: string) => h('label.ctl', null, h('span', null, label), h('input', { type: 'color', value: get(path), oninput: (e: Event) => set(path, (e.target as HTMLInputElement).value) }));
const pct = (v: number) => Math.round(v * 100) + '%';

export function settingsPanel(body: HTMLElement, opts: { inMatch?: boolean } = {}) {
  let tab = 'Graphics';
  const sections: Record<string, () => (Node | null)[]> = {
    Graphics: () => [
      select('Quality preset', 'graphics.quality', [['low', 'Low — recommended for most Android phones'], ['medium', 'Medium'], ['high', 'High — dynamic lights']]),
      slider('Render resolution', 'graphics.resolution', 0.4, 1, 0.05, pct),
      slider('Field of view', 'graphics.fov', 60, 110, 1, (v) => v + '°'),
      slider('View distance', 'graphics.viewDistance', 0.5, 1, 0.05, pct),
      slider('Particle density', 'graphics.particles', 0, 1, 0.05, pct),
      toggle('Shadows', 'graphics.shadows', 'Medium and High only. Costly on mobile.'),
      h('p.fine', null, 'Quality, shadows and view distance apply to the next match you load.'),
    ],
    Audio: () => [
      slider('Master volume', 'audio.master', 0, 1, 0.01, pct), slider('Effects', 'audio.sfx', 0, 1, 0.01, pct), slider('Ambience', 'audio.ambience', 0, 1, 0.01, pct),
      h('h4', null, 'Music'),
      slider('Music volume', 'audio.music', 0, 1, 0.01, pct), toggle('Mute music', 'audio.musicMuted'), toggle('Shuffle', 'audio.shuffle'),
      select('Repeat', 'audio.repeat', [['all', 'Repeat playlist'], ['one', 'Repeat current track'], ['off', 'Stop after the last track']]),
      music.status === 'ready'
        ? h('label.ctl', null, h('span', null, 'Track'), h('select', { onchange: (e: Event) => music.select(Number((e.target as HTMLSelectElement).value)) }, music.tracks.map((t, i) => h('option', { value: i, selected: i === music.index }, t.title))))
        : h('p.notice', { style: { display: 'block' } }, 'The lobby soundtrack is not installed on this server yet. It plays only the four supplied recordings (255, 257, 221, 201) once they are added to assets/music-src and extracted.'),
    ],
    Controls: () => [
      slider('Mouse sensitivity', 'controls.sensitivity', 0.1, 4, 0.05, (v) => v.toFixed(2)), slider('Touch look sensitivity', 'controls.touchSensitivity', 0.1, 4, 0.05, (v) => v.toFixed(2)),
      slider('Aim (ADS) sensitivity', 'controls.adsSensitivity', 0.1, 2, 0.05, (v) => v.toFixed(2)),
      toggle('Invert vertical look', 'controls.invertY'), toggle('Toggle aim instead of hold', 'controls.adsToggle', 'Mouse only — touch aim is always a toggle.'), toggle('Toggle crouch', 'controls.crouchToggle'),
      h('p.fine', null, 'Keyboard: WASD move · Shift sprint · Space jump · C / Ctrl crouch (while sprinting: slide) · R reload · Q or 1/2 switch · F inspect · Tab scoreboard · Esc menu. Mouse: left fire, right aim.'),
    ],
    Mobile: () => [
      slider('Button size', 'touch.scale', 0.6, 1.6, 0.05, pct), slider('Button opacity', 'touch.opacity', 0.15, 1, 0.05, pct),
      toggle('Left-handed layout', 'touch.leftHanded', 'Mirrors every button; the stick moves to the right.'),
      toggle('Auto-sprint', 'controls.autoSprint', 'Push the stick fully forward to sprint.'),
      toggle('Auto-fire when on target', 'touch.autoFire', 'Fires while your crosshair is on an enemy.'),
      app.touch ? h('div.row', null, h('button.btn', { onclick: () => bus.emit('touch:edit') }, 'Customise button layout'), h('button.btn.ghost', { onclick: () => { app.settings.touch.positions = {}; saveSettings(); } }, 'Reset layout'))
        : h('p.fine', null, 'Open SHOOTAY on a phone or tablet to drag the on-screen buttons where you want them.'),
    ],
    Crosshair: () => {
      const prev = h('div.crosshair.preview', null, ['t', 'b', 'l', 'r', 'dot'].map((d) => h('i', { class: 'c-' + d })));
      const sync = () => { const c = app.settings.crosshair; prev.dataset.style = c.style; prev.style.setProperty('--c-color', c.color); prev.style.setProperty('--c-size', c.size + 'px'); prev.style.setProperty('--c-thick', c.thickness + 'px'); prev.style.setProperty('--c-gap', c.gap + 'px'); prev.querySelector<HTMLElement>('.c-dot')!.style.display = c.dot || c.style === 'dot' ? 'block' : 'none'; };
      sync(); const off = bus.on('settings', sync); setTimeout(() => { if (!prev.isConnected) off(); }, 60000);
      return [h('div.cross-stage', null, prev), select('Style', 'crosshair.style', [['cross', 'Cross'], ['dot', 'Dot'], ['circle', 'Circle'], ['none', 'None']]), color('Colour', 'crosshair.color'),
        slider('Length', 'crosshair.size', 2, 30, 1), slider('Gap', 'crosshair.gap', 0, 20, 1), slider('Thickness', 'crosshair.thickness', 1, 6, 1), toggle('Centre dot', 'crosshair.dot'), toggle('Expand with weapon spread', 'crosshair.dynamic')];
    },
    HUD: () => [slider('HUD scale', 'hud.scale', 0.7, 1.4, 0.05, pct), slider('HUD opacity', 'hud.opacity', 0.3, 1, 0.05, pct), toggle('Kill feed', 'hud.killfeed'), toggle('Hit markers', 'hud.hitmarkers'), toggle('FPS and ping counter', 'hud.fps')],
    Accessibility: () => [
      color('Enemy highlight colour', 'accessibility.enemyColor'), toggle('Reduce camera shake', 'accessibility.reduceShake'), toggle('Reduce flashes', 'accessibility.reduceFlashes', 'Softens explosions, hit flashes and the damage vignette.'),
      toggle('Larger HUD text', 'accessibility.largeText'), toggle('High-contrast HUD', 'accessibility.highContrastHud'),
      h('h4', null, 'Gore'),
      slider('Stylised gore intensity', 'gore', 0, 1, 0.01, pct),
      h('p.fine', null, `Default ${Math.round(DEFAULT_SETTINGS.gore * 100)}%. Effects are abstract voxel bursts and floor marks, never realistic injuries. At 0% hits show sparks only.`),
    ],
    Privacy: () => [
      toggle('Public profile', 'privacy.publicProfile', 'Others can see your stats, loadout and recent matches.'), toggle('Allow friend requests', 'privacy.friendRequests'),
      toggle('Allow party and room invites', 'privacy.invites'), toggle('Show when I am online', 'privacy.showOnline', 'Off: friends always see you as offline.'),
      opts.inMatch ? null : h('div.row', null, h('button.btn.danger', { onclick: () => signOut() }, 'Sign out')),
    ],
  };
  const render = () => {
    clear(body);
    body.append(h('div.tabs', null, Object.keys(sections).map((t) => h('button.tab', { class: t === tab ? 'on' : '', onclick: () => { tab = t; render(); } }, t))), h('div.settings', null, sections[tab]()),
      h('p.fine', null, app.user ? 'Saved to your account automatically.' : 'Saved on this device.'));
  };
  render();
}
