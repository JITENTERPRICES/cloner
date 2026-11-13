// Overlays shown during a match: pause menu and the end-of-match results screen.
import { DEYES_PER_KILL } from '../../../shared/constants';
import { MAP_BY_ID } from '../../../shared/maps';
import { MODE_BY_ID } from '../../../shared/modes';
import { sfx } from '../engine/audio';
import { app } from '../state';
import { clear, deyes, h } from './dom';
import { settingsPanel } from './panels/settings';

const host = () => document.getElementById('ui')!;

export function showPause(onResume: () => void, onLeave: () => void) {
  hidePause();
  const body = h('div.pause-body');
  const main = () => {
    clear(body);
    body.append(h('h2', null, 'PAUSED'), h('p.muted', null, 'The match keeps running while this menu is open.'),
      h('button.btn.primary.big', { onclick: onResume }, 'Resume'),
      h('button.btn.big', { onclick: () => { clear(body); const s = h('div.pause-settings'); body.append(h('div.row.between', null, h('h2', null, 'SETTINGS'), h('button.btn.small', { onclick: main }, 'Back')), s); settingsPanel(s, { inMatch: true }); } }, 'Settings'),
      h('button.btn.danger.big', { onclick: onLeave }, 'Leave match'),
      h('p.fine', null, 'Leaving before the match ends forfeits its Deyes, XP and mission progress.'));
  };
  main();
  host().append(h('div.overlay.pause', { id: 'pause' }, body));
}
export const hidePause = () => document.getElementById('pause')?.remove();

export function showResults(end: any, isPrivate: boolean, onLeave: () => void) {
  document.getElementById('results')?.remove();
  const me = app.user!.id, mode = MODE_BY_ID[end.mode];
  const mine = end.board.find((r: any) => r.id === me);
  const won = !!mine?.won, draw = mode.teams ? end.winnerTeam < 0 : end.winnerId === null;
  if (won) sfx.victory(); else if (!draw) sfx.defeat();
  const rw = end.reward;
  const rows = (list: any[]) => list.map((r: any) => h('div.sb-row', { class: r.id === me ? 'me' : '' }, h('span', null, `${mode.id === 'br' ? '#' + r.placement + ' ' : ''}${r.name}`), h('span', null, r.score), h('span', null, r.kills), h('span', null, r.deaths)));
  const head = h('div.sb-row.head', null, h('span', null, 'PLAYER'), h('span', null, 'SCORE'), h('span', null, 'K'), h('span', null, 'D'));
  const el = h('div.overlay.results', { id: 'results', class: won ? 'win' : draw ? 'draw' : 'loss' },
    h('div.results-card', null,
      h('h1', null, won ? 'VICTORY' : draw ? 'DRAW' : 'DEFEAT'),
      h('p.muted', null, `${mode.name} · ${MAP_BY_ID[end.map]?.name ?? end.map} · ${end.reason}`),
      mode.teams ? h('div.final-score', null, h('b.ally', null, end.teamScores[mine?.team ?? 0]), h('span', null, '—'), h('b.enemy', null, end.teamScores[1 - (mine?.team ?? 0)])) : null,
      h('div.rewards', null,
        rw && end.eligible
          ? [h('h4', null, 'VERIFIED REWARDS'),
            h('div.reward-line', null, h('span', null, `${rw.rewardedKills} verified elimination${rw.rewardedKills === 1 ? '' : 's'} × ${DEYES_PER_KILL}`), deyes(rw.deyes, 'big')),
            rw.rewardedKills < rw.kills ? h('p.fine', null, `${rw.kills - rw.rewardedKills} elimination(s) were not rewarded (repeat-target limit).`) : null,
            h('div.reward-line', null, h('span', null, 'Experience'), h('b', null, `+${rw.xp} XP${rw.leveledUp ? ` — LEVEL ${rw.level}!` : ''}`)),
            h('div.reward-line', null, h('span', null, 'New balance'), deyes(rw.balance)),
            rw.missionsCompleted.length ? h('div.missions-done', null, h('b', null, 'Mission complete — claim it in Daily Missions:'), rw.missionsCompleted.map((t: string) => h('div', null, '✓ ' + t))) : null]
          : h('p.muted', null, end.error ?? (mode.rewards ? 'No rewards this match: it needs at least two players and a real contest to be verified.' : 'Training sessions do not earn rewards.'))),
      h('div.sb-team', null, head, mode.teams ? [h('h4', null, 'YOUR TEAM'), rows(end.board.filter((r: any) => r.team === mine?.team)), h('h4', null, 'ENEMY TEAM'), rows(end.board.filter((r: any) => r.team !== mine?.team))] : rows(end.board)),
      h('div.row', null, h('span.muted', null, isPrivate ? 'Returning to the room lobby…' : 'Next match starts shortly…'), h('button.btn.ghost', { onclick: onLeave }, 'Leave to lobby'))));
  host().append(el);
}
export const hideResults = () => document.getElementById('results')?.remove();
