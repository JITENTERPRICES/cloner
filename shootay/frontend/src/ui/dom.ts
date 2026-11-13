// Tiny DOM helpers. All dynamic text goes through textContent / text nodes — never innerHTML — so
// usernames and other player-supplied strings cannot inject markup.
import { DEYES_SYMBOL, RARITY_COLOR, Rarity } from '../../../shared/constants';
import { sfx } from '../engine/audio';
import { bus } from '../state';

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, any>;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const [name, ...classes] = tag.split('.') as [K, ...string[]];
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(' ');
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className += ' ' + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), k === 'onclick' ? (e: Event) => { sfx.ui('click'); v(e); } : v);
    else if (k in el && k !== 'list') (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  add(el, children);
  return el;
}
// allow h('div.foo.bar')
declare global { interface HTMLElementTagNameMap { [k: `${string}.${string}`]: HTMLElement } }
function add(el: Node, c: Child) {
  if (c === null || c === undefined || c === false) return;
  if (Array.isArray(c)) c.forEach((x) => add(el, x));
  else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
}
export const clear = (el: Element) => { while (el.firstChild) el.removeChild(el.firstChild); };
export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
export const deyes = (n: number, cls = '') => h('span.deyes', { class: cls, title: 'Deyes' }, h('span.deyes-sym', null, DEYES_SYMBOL), ' ', fmt(n));
export const rarityTag = (r: Rarity) => h('span.rarity', { style: { color: RARITY_COLOR[r], borderColor: RARITY_COLOR[r] } }, r.toUpperCase());
export const clock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function toast(msg: string, kind: 'info' | 'error' | 'good' = 'info', action?: { label: string; fn: () => void }, ttl = 4500) {
  const host = document.getElementById('toasts')!;
  const t = h('div.toast', { class: kind }, h('span', null, msg));
  if (action) t.appendChild(h('button.btn.small', { onclick: () => { action.fn(); t.remove(); } }, action.label));
  host.appendChild(t);
  if (kind === 'error') sfx.ui('error');
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, action ? 15000 : ttl);
}
bus.on('toast', (m: string) => toast(m));
/** Runs an async UI action and surfaces failures as a toast instead of an unhandled rejection. */
export const guard = <A extends any[]>(fn: (...a: A) => Promise<unknown> | unknown) => (...a: A) => { Promise.resolve().then(() => fn(...a)).catch((e) => toast(e?.message ?? 'Something went wrong', 'error')); };
