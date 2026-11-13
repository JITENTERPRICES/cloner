// Who is connected right now. One live socket per account.
import type { Socket } from 'socket.io';

export interface Session { userId: number; username: string; socket: Socket; roomCode: string | null; partyId: string | null; showOnline: boolean; allowInvites: boolean }
export const sessions = new Map<number, Session>();
export const isOnline = (userId: number) => sessions.has(userId);
export const onlineCount = () => sessions.size;
export function statusOf(userId: number): 'offline' | 'online' | 'in-match' {
  const s = sessions.get(userId);
  if (!s || !s.showOnline) return 'offline';
  return s.roomCode ? 'in-match' : 'online';
}
