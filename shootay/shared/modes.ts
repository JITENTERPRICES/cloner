export type ModeId = 'tdm' | 'ffa' | 'br' | 'gungame' | 'dom' | 'training';
export interface ModeDef {
  id: ModeId; name: string; teams: boolean; desc: string; rules: string[];
  timeLimit: number; scoreLimit: number; maxPlayers: number; minPlayers: number; respawn: boolean; rewards: boolean; lateJoin: boolean;
}
export const MODES: ModeDef[] = [
  { id: 'tdm', name: 'Team Deathmatch', teams: true, desc: 'Two teams. First to the score limit wins.', rules: ['First team to 30 eliminations', '8 minute limit — highest score wins', 'Respawn at your team base'], timeLimit: 480, scoreLimit: 30, maxPlayers: 10, minPlayers: 2, respawn: true, rewards: true, lateJoin: true },
  { id: 'ffa', name: 'Free For All', teams: false, desc: 'Every player for themselves.', rules: ['First player to 20 eliminations', '8 minute limit', 'Spawns pick the point farthest from enemies'], timeLimit: 480, scoreLimit: 20, maxPlayers: 8, minPlayers: 2, respawn: true, rewards: true, lateJoin: true },
  { id: 'gungame', name: 'Gun Game', teams: false, desc: 'Every elimination hands you the next weapon.', rules: ['12 weapon ladder, one elimination each', 'Finish the ladder to win', '8 minute limit — highest rung wins'], timeLimit: 480, scoreLimit: 12, maxPlayers: 8, minPlayers: 2, respawn: true, rewards: true, lateJoin: true },
  { id: 'dom', name: 'Domination', teams: true, desc: 'Hold zones A, B and C to score.', rules: ['Stand in a zone uncontested to capture it', 'Each held zone scores a point every 3 seconds', 'First to 100 or highest score at 8 minutes'], timeLimit: 480, scoreLimit: 100, maxPlayers: 10, minPlayers: 2, respawn: true, rewards: true, lateJoin: true },
  { id: 'br', name: 'Battle Royale', teams: false, desc: 'One life. The zone closes. Last operator standing.', rules: ['No respawns', 'The safe zone shrinks — outside it you take damage', 'Last player alive wins'], timeLimit: 300, scoreLimit: 0, maxPlayers: 12, minPlayers: 2, respawn: false, rewards: true, lateJoin: false },
  { id: 'training', name: 'Training Range', teams: false, desc: 'Solo practice against static targets. No rewards.', rules: ['Target dummies only', 'No Deyes, XP or mission progress'], timeLimit: 900, scoreLimit: 0, maxPlayers: 4, minPlayers: 1, respawn: true, rewards: false, lateJoin: true },
];
export const MODE_BY_ID: Record<string, ModeDef> = Object.fromEntries(MODES.map((m) => [m.id, m]));
export const PUBLIC_MODES: ModeId[] = ['tdm', 'ffa', 'gungame', 'dom', 'br'];

export interface RoomConfig { mode: ModeId; map: string; maxPlayers: number; timeLimit: number; scoreLimit: number; privacy: 'invite' | 'public'; teamSelect: boolean }
