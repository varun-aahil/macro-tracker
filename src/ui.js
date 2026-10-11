// small helpers shared by every screen
export const $ = (s, el = document) => el.querySelector(s);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

export const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseISO = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const shiftDay = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoOf(d); };
export const niceDate = iso => iso === today() ? "Today" : iso === shiftDay(today(), -1) ? "Yesterday"
  : parseISO(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
export const ICON = {
  today: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="3.5"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  add: '<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>',
  foods: '<svg viewBox="0 0 24 24"><path d="M7 3v7M10.5 3v7M7 10c0 1.7 1.5 2.5 1.75 2.5S10.5 11.7 10.5 10M8.75 12.5V21M17 21V3c-2.2 1.2-3.5 3.8-3.5 7.5H17"/></svg>',
  me: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
};

export function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}


export const r1 = n => Math.round(n * 10) / 10;
