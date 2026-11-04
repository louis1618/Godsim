/** Small hand-drawn HUD glyphs (inline SVG, ink outlined). */
const INK = '#2a2238';
const sw = { stroke: INK, 'stroke-width': 2.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' } as const;

export const Pause = () => <svg viewBox="0 0 24 24"><rect x="5" y="4" width="5" height="16" rx="2" fill="#fff" {...sw} /><rect x="14" y="4" width="5" height="16" rx="2" fill="#fff" {...sw} /></svg>;
export const Play = ({ n = 1 }: { n?: number }) => (
  <svg viewBox="0 0 24 24">
    {n === 1 && <path d="M7 4.5 L19 12 L7 19.5 Z" fill="#8fe06a" {...sw} />}
    {n === 2 && <><path d="M3 5 L12 12 L3 19 Z" fill="#ffd65a" {...sw} /><path d="M12 5 L21 12 L12 19 Z" fill="#ffd65a" {...sw} /></>}
    {n === 5 && <><path d="M2 5 L9 12 L2 19 Z" fill="#ff9a4a" {...sw} /><path d="M9 5 L16 12 L9 19 Z" fill="#ff9a4a" {...sw} /><path d="M16 5 L23 12 L16 19 Z" fill="#ff9a4a" {...sw} /></>}
    {n === 10 && <><path d="M2 5 L9 12 L2 19 Z" fill="#ff5a5a" {...sw} /><path d="M9 5 L16 12 L9 19 Z" fill="#ff5a5a" {...sw} /><path d="M16 5 L23 12 L16 19 Z" fill="#ff5a5a" {...sw} /><path d="M12 1 L13.5 4 L10.5 4 Z" fill={INK} /></>}
  </svg>
);
export const Season = ({ s }: { s: number }) => {
  if (s === 0) return <svg viewBox="0 0 32 32">{[0, 1, 2, 3, 4].map((i) => { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; return <ellipse cx={16 + Math.cos(a) * 7} cy={16 + Math.sin(a) * 7} rx="5.5" ry="5.5" fill="#ffb3cf" {...sw} />; })}<circle cx="16" cy="16" r="4.5" fill="#ffe066" {...sw} /></svg>;
  if (s === 1) return <svg viewBox="0 0 32 32">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i / 8) * Math.PI * 2; return <line x1={16 + Math.cos(a) * 10} y1={16 + Math.sin(a) * 10} x2={16 + Math.cos(a) * 14} y2={16 + Math.sin(a) * 14} {...sw} />; })}<circle cx="16" cy="16" r="7.5" fill="#ffd23a" {...sw} /></svg>;
  if (s === 2) return <svg viewBox="0 0 32 32"><path d="M16 3 C25 9 27 19 16 29 C5 19 7 9 16 3 Z" fill="#ff8a3a" {...sw} /><path d="M16 8 L16 27 M16 14 L11 11 M16 19 L21 15" {...sw} fill="none" /></svg>;
  return <svg viewBox="0 0 32 32">{[0, 1, 2].map((i) => { const a = (i / 3) * Math.PI; return <line x1={16 + Math.cos(a) * 12} y1={16 + Math.sin(a) * 12} x2={16 - Math.cos(a) * 12} y2={16 - Math.sin(a) * 12} {...sw} stroke="#5ab4ff" stroke-width="3.4" />; })}<circle cx="16" cy="16" r="3" fill="#fff" {...sw} /></svg>;
};
export const SEASON_BG = ['#ffe3ef', '#fff2b8', '#ffd9b8', '#e3f3ff'];
