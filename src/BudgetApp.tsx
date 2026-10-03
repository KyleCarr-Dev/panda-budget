import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, X, Trash2, Settings as SettingsIcon, Check, Download, Upload,
} from 'lucide-react';

/* ════════════════════════════════════════════════════════════════
   Panda Budget 🐼
   One file, no backend. Everything is stored in the browser
   (localStorage) under a single key, so it can be exported/imported.
   ════════════════════════════════════════════════════════════════ */

/* ───────────────────────── Config ───────────────────────── */

const CATEGORIES = {
  'Groceries':          { color: '#7ccf9b', emoji: '🛒' },
  'Dining Out':         { color: '#ffa96b', emoji: '🍜' },
  'Coffee':    { color: '#c49a7a', emoji: '☕' },
  'Treats': { color: '#ffd166', emoji: '🧸' },
  'Entertainment':      { color: '#b69cff', emoji: '🎬' },
  'Transport':          { color: '#6fb7ff', emoji: '🚌' },
  'Nightlife':          { color: '#ff6fb5', emoji: '🪩' },
  'Online Orders':      { color: '#4fd1c5', emoji: '📦' },
  'Miscellaneous':      { color: '#b3a4bd', emoji: '✨' },
} as const;

type CategoryKey = keyof typeof CATEGORIES;
const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[];
const catMeta = (key: string) => CATEGORIES[key as CategoryKey] ?? CATEGORIES.Miscellaneous;

const NIGHTLIFE_VENUES: { id: string; name: string; price: number | null }[] = [
  { id: 'club', name: 'Club night', price: 6 },
  { id: 'bar', name: 'Bar', price: 5 },
  { id: 'pub', name: 'Pub', price: 4 },
  { id: 'student', name: 'Student night', price: 2 },
  { id: 'other', name: 'Other', price: null },
];

const STORAGE_KEY = 'panda-budget-v1';
const LATTE_NOTE = 'Latte';

/* ───────────────────────── Types ───────────────────────── */

interface Expense {
  id: string;
  amount: number;
  category: CategoryKey;
  note: string;
  venue?: string;
  date: string;        // ISO timestamp
  fromStash?: boolean; // paid out of the Bamboo Stash instead of the weekly budget
}

interface AppData {
  version: 1;
  name: string;
  lattePrice: number;
  createdAt: string;   // when the app was first opened
  startedAt: string;   // Monday of that week (earliest date you can log against)
  vaultFrom: string;   // first full week that earns into the stash
  budgets: { from: string; amount: number }[]; // budget history, so past weeks keep their old target
  expenses: Expense[];
  seenWrap: string;    // last week-summary the user dismissed
}

type Mood = 'happy' | 'worried' | 'sad' | 'sleepy';
type SheetState = { type: 'add' } | { type: 'edit'; id: string } | { type: 'settings' } | null;

/* ───────────────────────── Date + money helpers ───────────────────────── */

const pad = (n: number) => String(n).padStart(2, '0');
const round2 = (n: number) => Math.round(n * 100) / 100;
const gbp = (n: number) => `${n < 0 ? '-' : ''}£${Math.abs(n).toFixed(2)}`;

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => { const x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); }; // Monday
const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();
const toInputDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromInputDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const fmtShort = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

const inRange = (iso: string, start: Date, end: Date) => {
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t < end.getTime();
};

/** Budget spending in [start, end). Stash spending is excluded on purpose. */
const sumRange = (expenses: Expense[], start: Date, end: Date) =>
  round2(expenses.filter(e => !e.fromStash && inRange(e.date, start, end)).reduce((s, e) => s + e.amount, 0));

const budgetFor = (budgets: AppData['budgets'], weekStart: Date) => {
  let amount = budgets[0]?.amount ?? 100;
  for (const b of budgets) if (new Date(b.from).getTime() <= weekStart.getTime()) amount = b.amount;
  return amount;
};

/* ───────────────────────── Persistence ───────────────────────── */

function freshData(now = new Date()): AppData {
  const monday = startOfWeek(now);
  const isMonday = sameDay(now, monday);
  return {
    version: 1,
    name: 'friend',
    lattePrice: 4.5,
    createdAt: now.toISOString(),
    startedAt: monday.toISOString(),
    // Starting mid-week is a "warm-up" week: it can't earn into the stash
    vaultFrom: (isMonday ? monday : addDays(monday, 7)).toISOString(),
    budgets: [{ from: monday.toISOString(), amount: 100 }],
    expenses: [],
    seenWrap: '',
  };
}

function isAppData(x: unknown): x is AppData {
  const d = x as AppData;
  return !!d && d.version === 1 && typeof d.name === 'string' && typeof d.lattePrice === 'number'
    && typeof d.startedAt === 'string' && typeof d.createdAt === 'string' && typeof d.vaultFrom === 'string'
    && Array.isArray(d.budgets) && d.budgets.length > 0 && Array.isArray(d.expenses);
}

function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isAppData(parsed)) return parsed;
    }
  } catch { /* storage unavailable, start fresh */ }
  return freshData();
}

/* ───────────────────────── Derived numbers ───────────────────────── */

function computeWeek(data: AppData, now: Date) {
  const start = startOfWeek(now);
  const end = addDays(start, 7);
  const budget = budgetFor(data.budgets, start);
  const spent = sumRange(data.expenses, start, end);
  const left = round2(budget - spent);
  const dayIdx = (startOfDay(now).getDay() + 6) % 7; // Mon = 0
  const daysLeft = 7 - dayIdx;
  const perDay = left > 0 ? left / daysLeft : 0;
  const used = budget > 0 ? spent / budget : 0;
  const elapsed = (dayIdx + (now.getHours() * 60 + now.getMinutes()) / 1440) / 7;
  const count = data.expenses.filter(e => inRange(e.date, start, end)).length;

  let mood: Mood = 'happy';
  if (left < 0) mood = 'sad';
  else if (count === 0) mood = 'sleepy';
  else if (used > elapsed + 0.2 && used > 0.3) mood = 'worried';

  return { start, end, budget, spent, left, dayIdx, daysLeft, perDay, used, count, mood };
}

/** Stash = every full week's unspent budget, minus anything paid from the stash.
 *  Derived (not stored), so editing or deleting an old expense can never corrupt it. */
function computeVault(data: AppData, now: Date) {
  const cur = startOfWeek(now);
  let w = new Date(data.vaultFrom);
  let earned = 0;
  while (w < cur) {
    const end = addDays(w, 7);
    earned += Math.max(0, budgetFor(data.budgets, w) - sumRange(data.expenses, w, end));
    w = end;
  }
  const paidFromStash = data.expenses.filter(e => e.fromStash).reduce((s, e) => s + e.amount, 0);
  return { earned: round2(earned), balance: Math.max(0, round2(earned - paidFromStash)) };
}

function computeStats(data: AppData, now: Date) {
  const cur = startOfWeek(now);
  const started = new Date(data.startedAt);

  const bars: { start: Date; spent: number; budget: number; current: boolean }[] = [];
  for (let i = 7; i >= 0; i--) {
    const ws = addDays(cur, -7 * i);
    if (ws < started) continue;
    bars.push({
      start: ws,
      spent: sumRange(data.expenses, ws, addDays(ws, 7)),
      budget: budgetFor(data.budgets, ws),
      current: i === 0,
    });
  }
  const completed = bars.filter(b => !b.current);
  const avgWeek = completed.length ? completed.reduce((s, b) => s + b.spent, 0) / completed.length : null;

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const month = data.expenses.filter(e => inRange(e.date, monthStart, monthEnd));
  const lattes = month.filter(e => e.category === 'Coffee');
  const treats = month.filter(e => e.category === 'Treats');
  const sum = (list: Expense[]) => round2(list.reduce((s, e) => s + e.amount, 0));
  const biggest = month.reduce<Expense | null>((m, e) => (!m || e.amount > m.amount ? e : m), null);

  // Days in a row with nothing logged (counts today until something is logged)
  const spentDays = new Set(data.expenses.map(e => toInputDate(new Date(e.date))));
  const floor = startOfDay(new Date(data.createdAt));
  let streak = 0;
  for (let d = startOfDay(now); d >= floor && !spentDays.has(toInputDate(d)); d = addDays(d, -1)) streak++;

  return {
    bars, avgWeek, streak, biggest,
    latteCount: lattes.length, latteTotal: sum(lattes), treatTotal: sum(treats),
  };
}

/** Re-render when the tab regains focus or every minute, so the week rolls over on its own. */
function useNow(offsetDays: number) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setTick(Date.now());
    const id = window.setInterval(update, 60000);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', update); };
  }, []);
  return useMemo(() => new Date(tick + offsetDays * 86400000), [tick, offsetDays]);
}

/* ───────────────────────── Copy ───────────────────────── */

const MESSAGES: Record<Mood, (n: string) => string[]> = {
  happy: n => [
    `You're doing so well, ${n}! Bamboo budget looking lovely 🎋`,
    'On track and looking cute about it 💖',
    'All good this week. A coffee later, maybe? ☕',
  ],
  worried: () => [
    'Spending is running a bit ahead of the week. Maybe a cosy night in? 🧸',
    "Let's save some bamboo for the weekend 🎋",
  ],
  sad: n => [
    'Over budget this week. It happens! Fresh start on Monday 🐼',
    `No stress, ${n}. Log it, learn from it, move on 💗`,
  ],
  sleepy: () => [
    'Nothing logged yet. Tap + when you spend 😴',
    'Zzz… wake me when you buy a latte ☕',
  ],
};

/* ───────────────────────── Styles ───────────────────────── */

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Nunito:wght@600;700;800&display=swap');

.nv-root{
  --ink:#4a2c3a; --muted:#8a6478;
  --p50:#fff5f8; --p100:#ffe4ee; --p200:#ffc9dc; --p300:#ffa3c4; --p400:#ff7aa8; --p500:#f4508a; --p600:#d63a73;
  --cream:#fff9f2; --mint:#7ccf9b;
  font-family:'Nunito',ui-rounded,'SF Pro Rounded',system-ui,sans-serif;
  color:var(--ink);
  min-height:100vh; min-height:100dvh;
  background:
    radial-gradient(circle at 15% -8%,#ffd6e6 0,transparent 42%),
    radial-gradient(circle at 105% 4%,#fff0d9 0,transparent 38%),
    var(--p50);
  -webkit-tap-highlight-color:transparent;
}
.nv-root *{box-sizing:border-box}
.nv-root button{font-family:inherit;cursor:pointer}
.nv-title{font-family:'Fredoka','Nunito',ui-rounded,system-ui,sans-serif;letter-spacing:.005em}
.nv-muted{color:var(--muted)}
.nv-col{max-width:28rem;margin:0 auto;padding:calc(env(safe-area-inset-top,0px) + 22px) 18px 150px}

/* squishy press: everything you can tap gives a little */
.squish{transition:transform .28s cubic-bezier(.34,1.7,.64,1)}
.squish:active{transform:scale(.93,.87)}

.nv-card{background:#fff;border-radius:26px;border:1.5px solid var(--p100);box-shadow:0 12px 28px -18px rgba(244,80,138,.5)}
.nv-hero{
  border-radius:34px;padding:18px 16px 16px;
  background:
    radial-gradient(rgba(255,255,255,.6) 1.6px,transparent 1.9px) 0 0/16px 16px,
    linear-gradient(160deg,#ffd3e3,#ffb5d1 58%,#ffc9bb);
  box-shadow:0 22px 40px -22px rgba(214,58,115,.75);
}
.nv-bubble{position:relative;background:#fff;border-radius:20px;padding:11px 14px;font-weight:700;font-size:13.5px;line-height:1.35;box-shadow:0 6px 14px -8px rgba(214,58,115,.5)}
.nv-bubble::before{content:'';position:absolute;left:-6px;top:28px;width:14px;height:14px;background:#fff;border-radius:3px;transform:rotate(45deg)}
.nv-big{font-size:50px;line-height:1;font-weight:700}
.nv-over{color:#b3123f}
.nv-mini{background:rgba(255,255,255,.78);border-radius:20px;padding:9px 4px 8px;text-align:center}
.nv-mini b{display:block;font-family:'Fredoka',ui-rounded,sans-serif;font-size:17px;font-weight:600}
.nv-mini span{display:block;font-size:11px;font-weight:700;color:var(--muted)}

/* bamboo meter: seven joints = seven days */
.nv-bamboo{position:relative;height:24px;border-radius:999px;background:rgba(255,255,255,.8);box-shadow:inset 0 2px 5px rgba(214,58,115,.18);overflow:hidden}
.nv-bamboo-fill{height:100%;border-radius:999px;background:linear-gradient(180deg,#c4edd0,#7ccf9b);transition:width .9s cubic-bezier(.34,1.2,.64,1)}
.nv-bamboo-fill.low{background:linear-gradient(180deg,#ffc2d9,#ff7aa8)}
.nv-bamboo-joints{position:absolute;inset:0;background-image:repeating-linear-gradient(90deg,transparent 0,transparent calc(100%/7 - 3px),rgba(255,255,255,.95) calc(100%/7 - 3px),rgba(255,255,255,.95) calc(100%/7))}
.nv-days{display:flex;margin-top:5px}
.nv-days span{flex:1;text-align:center;font-size:11px;font-weight:800;color:rgba(74,44,58,.55)}
.nv-days span.today{color:var(--p600)}

.nv-seg{display:flex;background:var(--p100);border-radius:999px;padding:4px}
.nv-seg button{flex:1;padding:8px 10px;border-radius:999px;border:0;background:transparent;font-weight:800;font-size:13.5px;color:var(--muted)}
.nv-seg button.on{background:#fff;color:var(--p600);box-shadow:0 4px 10px -5px rgba(214,58,115,.6)}

.nv-row{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;background:#fff;border-radius:20px;border:1.5px solid #fff0f5;text-align:left;color:var(--ink)}
.nv-tile{width:44px;height:44px;border-radius:16px;display:grid;place-items:center;font-size:22px;flex-shrink:0}
.nv-daylabel{font-weight:800;font-size:13px;color:var(--muted);padding:0 6px;margin:16px 0 8px}

.nv-iconbtn{width:44px;height:44px;border-radius:50%;background:#fff;border:1.5px solid var(--p100);display:grid;place-items:center;color:var(--p600);box-shadow:0 8px 16px -10px rgba(214,58,115,.7)}
.nv-btn{width:100%;padding:15px;border-radius:999px;border:0;font-family:'Fredoka',ui-rounded,sans-serif;font-weight:600;font-size:18px;color:#fff;background:linear-gradient(160deg,var(--p300),var(--p500));box-shadow:0 14px 24px -12px rgba(244,80,138,.9)}
.nv-btn:disabled{opacity:.45;box-shadow:none;cursor:not-allowed}
.nv-btn.ghost{background:#fff;color:var(--p600);border:1.5px solid var(--p200);box-shadow:none}
.nv-link{background:none;border:0;color:#b3123f;font-weight:800;font-size:14px;padding:10px}

.nv-field{background:#fff;border:1.5px solid var(--p100);border-radius:20px;padding:8px 14px 10px}
.nv-field label{display:block;font-size:12.5px;font-weight:800;color:var(--muted);margin-bottom:2px}
.nv-input{width:100%;background:transparent;border:0;outline:0;font:inherit;font-weight:800;font-size:17px;color:var(--ink);padding:2px 0}
.nv-input::placeholder{color:#d9bccb}
.nv-amount{font-family:'Fredoka',ui-rounded,sans-serif;font-size:58px;font-weight:700;width:200px;text-align:center;background:transparent;border:0;outline:0;color:var(--ink)}
.nv-amount::placeholder{color:var(--p200)}
.nv-amount::-webkit-inner-spin-button,.nv-amount::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.nv-input:focus-visible,.nv-amount:focus-visible{outline:none}
.nv-field:focus-within{border-color:var(--p400);box-shadow:0 0 0 4px rgba(255,122,168,.2)}
.nv-root button:focus-visible{outline:3px solid var(--p400);outline-offset:2px}

.nv-cats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.nv-chip{display:flex;flex-direction:column;align-items:center;gap:3px;padding:10px 4px;border-radius:20px;border:2px solid transparent;background:#fff;font-weight:800;font-size:12px;line-height:1.15;text-align:center;color:var(--ink)}
.nv-chip .em{font-size:23px}
.nv-chip.on{border-color:var(--p400);background:var(--p50);box-shadow:0 8px 16px -10px rgba(244,80,138,.9)}
.nv-pill{padding:8px 13px;border-radius:999px;background:#fff;border:1.5px solid var(--p100);font-weight:800;font-size:13px;color:var(--ink);white-space:nowrap}
.nv-pill.on{background:var(--p500);border-color:var(--p500);color:#fff}
.nv-scroll{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 6px;scrollbar-width:none}
.nv-scroll::-webkit-scrollbar{display:none}

.nv-switch{position:relative;width:48px;height:28px;border-radius:999px;border:0;background:var(--p100);flex-shrink:0;transition:background .2s}
.nv-switch::after{content:'';position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.2);transition:transform .3s cubic-bezier(.34,1.7,.64,1)}
.nv-switch[aria-checked="true"]{background:var(--mint)}
.nv-switch[aria-checked="true"]::after{transform:translateX(20px)}

.nv-tabbar{position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:100%;max-width:28rem;z-index:30;
  display:grid;grid-template-columns:1fr auto 1fr;align-items:center;
  padding:8px 18px calc(env(safe-area-inset-bottom,0px) + 10px);
  background:rgba(255,255,255,.9);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border-radius:28px 28px 0 0;box-shadow:0 -10px 30px -14px rgba(214,58,115,.55)}
.nv-tab{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px;border:0;background:none;font-weight:800;font-size:12px;color:var(--muted)}
.nv-tab .em{font-size:23px;filter:grayscale(.7);opacity:.65;transition:all .2s}
.nv-tab.on{color:var(--p600)}
.nv-tab.on .em{filter:none;opacity:1}
.nv-fab{width:66px;height:66px;margin:-36px 16px 0;border-radius:50%;border:4px solid #fff;color:#fff;display:grid;place-items:center;background:linear-gradient(160deg,var(--p300),var(--p500));box-shadow:0 14px 26px -8px rgba(244,80,138,.85)}

.nv-modal{position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;justify-content:flex-end;align-items:center}
.nv-backdrop{position:absolute;inset:0;background:rgba(74,44,58,.38);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);animation:nv-fade .2s both}
.nv-sheet{position:relative;width:100%;max-width:28rem;max-height:94vh;max-height:94dvh;overflow-y:auto;background:var(--cream);border-radius:34px 34px 0 0;padding:18px 18px calc(env(safe-area-inset-bottom,0px) + 24px);animation:nv-sheet .38s cubic-bezier(.22,1.1,.36,1) both}
.nv-grab{width:44px;height:5px;border-radius:99px;background:var(--p200);margin:-6px auto 12px}

.nv-toast-wrap{position:fixed;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 100px);display:flex;justify-content:center;z-index:60;pointer-events:none;padding:0 18px}
.nv-toast{pointer-events:auto;display:flex;align-items:center;gap:12px;background:var(--ink);color:#fff;border-radius:999px;padding:11px 12px 11px 18px;font-weight:800;font-size:14px;box-shadow:0 14px 28px -10px rgba(74,44,58,.7);animation:nv-pop .35s cubic-bezier(.34,1.7,.64,1) both}
.nv-toast button{background:rgba(255,255,255,.18);border:0;color:#fff;font-weight:800;font-size:13px;padding:6px 12px;border-radius:999px}

.nv-bar{width:70%;max-width:26px;border-radius:10px 10px 4px 4px;background:linear-gradient(180deg,var(--p300),var(--p400));transition:height .7s cubic-bezier(.34,1.3,.64,1)}
.nv-bar.over{background:linear-gradient(180deg,#ffb9a6,#ff7f6e)}
.nv-bar.cur{opacity:.6}
.nv-tick{position:absolute;left:4%;right:4%;border-top:2px dashed var(--mint)}
.nv-stat{padding:14px;border-radius:24px;background:#fff;border:1.5px solid var(--p100)}
.nv-stat b{display:block;font-family:'Fredoka',ui-rounded,sans-serif;font-size:24px;font-weight:600;line-height:1.15}
.nv-stat p{font-size:12.5px;font-weight:700;color:var(--muted);margin-top:2px}

.nv-bob{animation:nv-bob 3.6s ease-in-out infinite}
.nv-blink{transform-box:fill-box;transform-origin:center;animation:nv-blink 5.5s infinite}

@keyframes nv-bob{0%,100%{transform:translateY(0) rotate(-1.5deg)}50%{transform:translateY(-4px) rotate(1.5deg)}}
@keyframes nv-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes nv-fade{from{opacity:0}to{opacity:1}}
@keyframes nv-sheet{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes nv-pop{from{opacity:0;transform:scale(.8) translateY(10px)}to{opacity:1;transform:none}}

@media (prefers-reduced-motion:reduce){
  .nv-bob,.nv-blink,.nv-sheet,.nv-backdrop,.nv-toast{animation:none}
  .squish,.nv-bamboo-fill,.nv-bar{transition:none}
}
`;

/* ───────────────────────── Panda ───────────────────────── */

function Panda({ mood = 'happy', size = 96 }: { mood?: Mood; size?: number }) {
  const ink = '#2f2430';
  const openEyes = mood !== 'sleepy';
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`Panda feeling ${mood}`}>
      {/* ears */}
      <circle cx="26" cy="30" r="16" fill={ink} />
      <circle cx="94" cy="30" r="16" fill={ink} />
      <circle cx="26" cy="30" r="7" fill="#ff8fb8" opacity=".5" />
      <circle cx="94" cy="30" r="7" fill="#ff8fb8" opacity=".5" />
      {/* head */}
      <ellipse cx="60" cy="68" rx="48" ry="44" fill="#fff" stroke="#f6d3e0" strokeWidth="2" />
      {/* bow */}
      <g transform="translate(102 17) rotate(22)">
        <path d="M0 0 L-12 -8 L-12 8 Z" fill="#ff5c9a" />
        <path d="M0 0 L12 -8 L12 8 Z" fill="#ff5c9a" />
        <circle r="3.4" fill="#ffa3c4" />
      </g>
      {/* eye patches */}
      <ellipse cx="40" cy="64" rx="11" ry="14" fill={ink} transform="rotate(25 40 64)" />
      <ellipse cx="80" cy="64" rx="11" ry="14" fill={ink} transform="rotate(-25 80 64)" />
      {/* eyes */}
      {openEyes ? (
        <g className="nv-blink">
          <circle cx="41" cy="63" r="6" fill="#fff" />
          <circle cx="79" cy="63" r="6" fill="#fff" />
          <circle cx={mood === 'worried' ? 40.2 : 41.6} cy="63.6" r="3.8" fill={ink} />
          <circle cx={mood === 'worried' ? 78.2 : 79.6} cy="63.6" r="3.8" fill={ink} />
          <circle cx="42.6" cy="62.2" r="1.4" fill="#fff" />
          <circle cx="80.6" cy="62.2" r="1.4" fill="#fff" />
        </g>
      ) : (
        <g stroke="#fff" strokeWidth="2.8" fill="none" strokeLinecap="round">
          <path d="M35 63 Q40 68 45 63" />
          <path d="M75 63 Q80 68 85 63" />
        </g>
      )}
      {mood === 'worried' && (
        <g stroke={ink} strokeWidth="2.4" strokeLinecap="round">
          <path d="M31 47 L46 41" />
          <path d="M74 41 L89 47" />
        </g>
      )}
      {mood === 'sad' && <path d="M33 76 Q29 82 33 86 Q37 82 33 76Z" fill="#8fd0ff" />}
      {/* nose + mouth */}
      <ellipse cx="60" cy="79" rx="6" ry="4.2" fill={ink} />
      <g stroke={ink} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {(mood === 'happy' || mood === 'sleepy') && <path d="M60 83 L60 86 M52 87 Q56 92 60 86 Q64 92 68 87" />}
        {mood === 'worried' && <path d="M52 92 Q56 88 60 91 Q64 94 68 90" />}
        {mood === 'sad' && <path d="M52 94 Q60 87 68 94" />}
      </g>
      {/* blush */}
      <circle cx="26" cy="86" r="7" fill="#ff7fa8" opacity=".45" />
      <circle cx="94" cy="86" r="7" fill="#ff7fa8" opacity=".45" />
    </svg>
  );
}

/* ───────────────────────── Small components ───────────────────────── */

function BambooMeter({ fraction, dayIdx }: { fraction: number; dayIdx: number }) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div>
      <div className="nv-bamboo" role="img" aria-label={`${Math.round(pct)}% of this week's budget left`}>
        <div className={`nv-bamboo-fill ${pct < 20 ? 'low' : ''}`} style={{ width: `${pct}%` }} />
        <div className="nv-bamboo-joints" />
      </div>
      <div className="nv-days" aria-hidden="true">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className={i === dayIdx ? 'today' : ''}>{d}</span>
        ))}
      </div>
    </div>
  );
}

function DonutChart({ totals, total }: { totals: [string, number][]; total: number }) {
  const r = 15.9155;
  let cumulative = 0;
  return (
    <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }} aria-hidden="true">
      <circle cx="18" cy="18" r={r} fill="none" stroke="#ffeaf2" strokeWidth="4.2" />
      {total > 0 && totals.map(([cat, amt]) => {
        const pct = (amt / total) * 100;
        const single = totals.length === 1;
        const dash = single ? 100 : Math.max(pct - 1.4, 0.2);
        const offset = -(cumulative + (single ? 0 : 0.7));
        cumulative += pct;
        return (
          <circle
            key={cat} cx="18" cy="18" r={r} fill="none"
            stroke={catMeta(cat).color} strokeWidth="4.2"
            strokeDasharray={`${dash} ${100 - dash}`} strokeDashoffset={offset}
            style={{ transition: 'stroke-dasharray .8s ease' }}
          />
        );
      })}
    </svg>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div className="nv-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="nv-backdrop" onClick={onClose} />
      <div className="nv-sheet">
        <div className="nv-grab" />
        <div className="flex items-center justify-between mb-4">
          <h2 className="nv-title" style={{ fontSize: 24, fontWeight: 700 }}>{title}</h2>
          <button className="nv-iconbtn squish" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ───────────────────────── Add / edit sheet ───────────────────────── */

interface Preset { category: CategoryKey; amount: number; note: string; venue?: string }

interface ExpenseSheetProps {
  initial?: Expense;
  lattePrice: number;
  recents: Expense[];
  stashBalance: number;
  now: Date;
  minDate: Date;
  onSave: (e: Expense) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}

function ExpenseSheet({ initial, lattePrice, recents, stashBalance, now, minDate, onSave, onDelete, onClose }: ExpenseSheetProps) {
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [category, setCategory] = useState<CategoryKey | ''>(initial?.category ?? '');
  const [venue, setVenue] = useState(initial?.venue ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [dateStr, setDateStr] = useState(toInputDate(initial ? new Date(initial.date) : now));
  const [fromStash, setFromStash] = useState(initial?.fromStash ?? false);

  const amt = parseFloat(amount);
  const stashRoom = round2(stashBalance + (initial?.fromStash ? initial.amount : 0));
  const overStash = fromStash && Number.isFinite(amt) && amt > stashRoom;
  const valid = Number.isFinite(amt) && amt > 0 && category !== '' && !overStash;

  const presets: (Preset & { label: string })[] = [
    { label: `Latte ${gbp(lattePrice)}`, category: 'Coffee', amount: lattePrice, note: LATTE_NOTE },
    ...recents.map(r => ({
      label: `${r.note || r.category} ${gbp(r.amount)}`,
      category: r.category, amount: r.amount, note: r.note, venue: r.venue,
    })),
  ];

  const applyPreset = (p: Preset) => {
    setAmount(String(p.amount));
    setCategory(p.category);
    setNote(p.note);
    setVenue(p.venue ?? '');
  };

  const pickVenue = (id: string) => {
    setVenue(id);
    const v = NIGHTLIFE_VENUES.find(x => x.id === id);
    if (v && v.price !== null) {
      setAmount(String(v.price));
      if (!note) setNote(v.name);
    }
  };

  const handleSave = () => {
    if (!valid || !category) return;
    let picked = dateStr ? fromInputDate(dateStr) : now;
    if (picked.getTime() > now.getTime()) picked = now;
    if (picked < minDate) picked = minDate;

    let iso: string;
    if (initial && sameDay(new Date(initial.date), picked)) iso = initial.date;
    else if (sameDay(picked, now)) iso = now.toISOString();
    else iso = picked.toISOString();

    onSave({
      id: initial?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      amount: round2(amt),
      category,
      note: note.trim(),
      venue: category === 'Nightlife' && venue ? venue : undefined,
      date: iso,
      fromStash: fromStash || undefined,
    });
  };

  return (
    <Modal title={initial ? 'Edit spend' : 'New spend'} onClose={onClose}>
      {!initial && (
        <div className="mb-4">
          <p className="nv-muted" style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Quick fill</p>
          <div className="nv-scroll">
            {presets.map((p, i) => (
              <button key={i} className="nv-pill squish" onClick={() => applyPreset(p)}>
                {catMeta(p.category).emoji} {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col items-center mb-4">
        <span className="nv-muted" style={{ fontSize: 13, fontWeight: 800 }}>How much?</span>
        <div className="flex items-center justify-center">
          <span className="nv-title" style={{ fontSize: 38, fontWeight: 700, color: 'var(--p300)' }}>£</span>
          <input
            className="nv-amount" type="number" inputMode="decimal" step="0.01" min="0"
            value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
            autoFocus={!initial} aria-label="Amount in pounds"
          />
        </div>
      </div>

      <p className="nv-muted" style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>What kind of spend?</p>
      <div className="nv-cats mb-4">
        {CATEGORY_KEYS.map(k => (
          <button
            key={k} className={`nv-chip squish ${category === k ? 'on' : ''}`}
            onClick={() => { setCategory(k); if (k !== 'Nightlife') setVenue(''); }}
            aria-pressed={category === k}
          >
            <span className="em">{CATEGORIES[k].emoji}</span>{k}
          </button>
        ))}
      </div>

      {category === 'Nightlife' && (
        <div className="mb-4">
          <p className="nv-muted" style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Which spot?</p>
          <div className="flex flex-wrap gap-2">
            {NIGHTLIFE_VENUES.map(v => (
              <button key={v.id} className={`nv-pill squish ${venue === v.id ? 'on' : ''}`} onClick={() => pickVenue(v.id)}>
                {v.name}{v.price !== null ? ` ${gbp(v.price)}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3 mb-4">
        <div className="nv-field">
          <label htmlFor="nv-note">Note</label>
          <input id="nv-note" className="nv-input" type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="What was this for?" />
        </div>
        <div className="nv-field">
          <label htmlFor="nv-date">Date</label>
          <input
            id="nv-date" className="nv-input" type="date" value={dateStr}
            min={toInputDate(minDate)} max={toInputDate(now)}
            onChange={e => setDateStr(e.target.value)}
          />
        </div>
      </div>

      <div className="nv-card flex items-center gap-3 mb-2" style={{ padding: '12px 14px' }}>
        <span style={{ fontSize: 26 }}>🎋</span>
        <div className="flex-1">
          <div style={{ fontWeight: 800, fontSize: 15 }}>Pay from Bamboo Stash</div>
          <div className="nv-muted" style={{ fontSize: 12.5, fontWeight: 700 }}>
            {gbp(stashRoom)} in the stash. Doesn't touch this week's budget.
          </div>
        </div>
        <button
          className="nv-switch" role="switch" aria-checked={fromStash} aria-label="Pay from Bamboo Stash"
          disabled={stashRoom <= 0 && !fromStash}
          onClick={() => setFromStash(v => !v)}
        />
      </div>
      {overStash && (
        <p style={{ color: '#b3123f', fontSize: 13, fontWeight: 800, margin: '4px 6px 0' }}>
          That's more than the {gbp(stashRoom)} in your stash.
        </p>
      )}

      <div className="pt-4">
        <button className="nv-btn squish" onClick={handleSave} disabled={!valid}>
          {initial ? 'Save changes' : 'Save spend'}
        </button>
        {initial && onDelete && (
          <button className="nv-link" style={{ width: '100%', marginTop: 6 }} onClick={() => onDelete(initial.id)}>
            Delete this spend
          </button>
        )}
      </div>
    </Modal>
  );
}

/* ───────────────────────── Settings sheet ───────────────────────── */

interface SettingsSheetProps {
  data: AppData;
  currentBudget: number;
  onSave: (v: { name: string; budget: number; lattePrice: number }) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onReset: () => void;
  onClose: () => void;
}

function SettingsSheet({ data, currentBudget, onSave, onExport, onImport, onReset, onClose }: SettingsSheetProps) {
  const [name, setName] = useState(data.name);
  const [budget, setBudget] = useState(String(currentBudget));
  const [latte, setLatte] = useState(String(data.lattePrice));

  const b = parseFloat(budget);
  const l = parseFloat(latte);
  const valid = name.trim().length > 0 && Number.isFinite(b) && b > 0 && Number.isFinite(l) && l > 0;

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="space-y-3 mb-4">
        <div className="nv-field">
          <label htmlFor="nv-name">Name</label>
          <input id="nv-name" className="nv-input" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="nv-field">
          <label htmlFor="nv-budget">Weekly budget (£), from this week on</label>
          <input id="nv-budget" className="nv-input" type="number" inputMode="decimal" step="0.01" value={budget} onChange={e => setBudget(e.target.value)} />
        </div>
        <div className="nv-field">
          <label htmlFor="nv-latte">Price of your usual coffee (£)</label>
          <input id="nv-latte" className="nv-input" type="number" inputMode="decimal" step="0.01" value={latte} onChange={e => setLatte(e.target.value)} />
        </div>
      </div>

      <button
        className="nv-btn squish" disabled={!valid}
        onClick={() => onSave({ name: name.trim(), budget: round2(b), lattePrice: round2(l) })}
      >
        <Check size={18} style={{ display: 'inline', marginRight: 6, verticalAlign: '-3px' }} />
        Save settings
      </button>

      <div className="nv-card" style={{ padding: 14, marginTop: 18 }}>
        <p style={{ fontWeight: 800, fontSize: 15 }}>Back up your data</p>
        <p className="nv-muted" style={{ fontSize: 12.5, fontWeight: 700, margin: '2px 0 10px' }}>
          Everything lives on this phone. Save a backup now and then in case it's ever wiped.
        </p>
        <div className="flex gap-2">
          <button className="nv-btn ghost squish" style={{ fontSize: 15, padding: 11 }} onClick={onExport}>
            <Download size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: '-3px' }} />Export
          </button>
          <label className="nv-btn ghost squish" style={{ fontSize: 15, padding: 11, textAlign: 'center', cursor: 'pointer' }}>
            <Upload size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: '-3px' }} />Import
            <input
              type="file" accept="application/json,.json" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }}
            />
          </label>
        </div>
      </div>

      <button className="nv-link" style={{ width: '100%', marginTop: 10 }} onClick={onReset}>
        Start over (deletes everything)
      </button>
    </Modal>
  );
}

/* ───────────────────────── Stats view ───────────────────────── */

function StatsView({ stats, vaultEarned, hasData }: {
  stats: ReturnType<typeof computeStats>; vaultEarned: number; hasData: boolean;
}) {
  const maxVal = Math.max(1, ...stats.bars.map(b => Math.max(b.spent, b.budget))) * 1.12;

  return (
    <div className="space-y-4">
      <section className="nv-card" style={{ padding: 16 }}>
        <h3 className="nv-title" style={{ fontSize: 18, fontWeight: 600 }}>Week by week</h3>
        <p className="nv-muted" style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 12 }}>
          Pink bars are what you spent. The green dashes are your budget.
        </p>
        <div className="flex gap-1.5" style={{ alignItems: 'flex-end' }}>
          {stats.bars.map(b => (
            <div key={b.start.toISOString()} className="flex-1 flex flex-col items-center" style={{ gap: 4 }}>
              <div className="relative w-full flex items-end justify-center" style={{ height: 150 }}>
                <div className="nv-tick" style={{ bottom: `${(b.budget / maxVal) * 100}%` }} />
                <div
                  className={`nv-bar ${b.spent > b.budget ? 'over' : ''} ${b.current ? 'cur' : ''}`}
                  style={{ height: `${Math.max((b.spent / maxVal) * 100, b.spent > 0 ? 3 : 0)}%` }}
                />
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 800 }}>£{Math.round(b.spent)}</span>
              <span className="nv-muted" style={{ fontSize: 10.5, fontWeight: 700 }}>
                {b.start.getDate()}/{b.start.getMonth() + 1}
              </span>
            </div>
          ))}
        </div>
      </section>

      {!hasData && (
        <div className="nv-card" style={{ padding: 22, textAlign: 'center' }}>
          <div className="nv-bob" style={{ display: 'inline-block' }}><Panda mood="sleepy" size={84} /></div>
          <p style={{ fontWeight: 800, marginTop: 6 }}>Log a few spends and your patterns will show up here.</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="nv-stat">
          <span style={{ fontSize: 22 }}>☕</span>
          <b>{stats.latteCount} {stats.latteCount === 1 ? 'latte' : 'lattes'}</b>
          <p>{gbp(stats.latteTotal)} this month</p>
        </div>
        <div className="nv-stat">
          <span style={{ fontSize: 22 }}>🧸</span>
          <b>{gbp(stats.treatTotal)}</b>
          <p>on treats this month</p>
        </div>
        <div className="nv-stat">
          <span style={{ fontSize: 22 }}>🌙</span>
          <b>{stats.streak} {stats.streak === 1 ? 'day' : 'days'}</b>
          <p>{stats.streak > 0 ? 'in a row with no spending' : 'Spent today. Streak starts again tomorrow'}</p>
        </div>
        <div className="nv-stat">
          <span style={{ fontSize: 22 }}>🎋</span>
          <b>{gbp(vaultEarned)}</b>
          <p>saved into the stash so far</p>
        </div>
        <div className="nv-stat">
          <span style={{ fontSize: 22 }}>📅</span>
          <b>{stats.avgWeek === null ? 'Not yet' : gbp(stats.avgWeek)}</b>
          <p>{stats.avgWeek === null ? 'Needs one finished week' : 'average per finished week'}</p>
        </div>
        <div className="nv-stat">
          <span style={{ fontSize: 22 }}>🏆</span>
          <b>{stats.biggest ? gbp(stats.biggest.amount) : 'None yet'}</b>
          <p>{stats.biggest ? `biggest spend this month: ${stats.biggest.note || stats.biggest.category}` : 'biggest spend this month'}</p>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── App ───────────────────────── */

export default function App() {
  const [data, setData] = useState<AppData>(loadData);
  const [devDays, setDevDays] = useState(0);
  const now = useNow(devDays);

  const [tab, setTab] = useState<'home' | 'stats'>('home');
  const [timeframe, setTimeframe] = useState<'weekly' | 'monthly'>('weekly');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);

  const showDev = useMemo(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev'), []);

  /* persistence */
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }, [data]);

  useEffect(() => {
    // Ask the browser not to evict our data when storage is tight
    try { navigator.storage?.persist?.(); } catch { /* ignore */ }
    document.title = "Panda Budget 🐼";
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  /* derived */
  const week = useMemo(() => computeWeek(data, now), [data, now]);
  const vault = useMemo(() => computeVault(data, now), [data, now]);
  const stats = useMemo(() => computeStats(data, now), [data, now]);

  const scope = useMemo(() => {
    const start = timeframe === 'weekly' ? week.start : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = timeframe === 'weekly' ? week.end : new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const list = data.expenses
      .filter(e => inRange(e.date, start, end))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const total = round2(list.reduce((s, e) => s + e.amount, 0));
    const stashTotal = round2(list.filter(e => e.fromStash).reduce((s, e) => s + e.amount, 0));

    const byCat = new Map<string, number>();
    list.forEach(e => byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount));
    const catTotals = Array.from(byCat.entries()).sort((a, b) => b[1] - a[1]);

    const groups: { key: string; label: string; items: Expense[] }[] = [];
    list.forEach(e => {
      const d = new Date(e.date);
      const key = toInputDate(d);
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) {
        const label = sameDay(d, now) ? 'Today' : sameDay(d, addDays(now, -1)) ? 'Yesterday' : fmtDay(d);
        g = { key, label, items: [] };
        groups.push(g);
      }
      g.items.push(e);
    });

    return { list, total, stashTotal, catTotals, groups };
  }, [data.expenses, timeframe, week, now]);

  const recents = useMemo(() => {
    const seen = new Set<string>();
    const out: Expense[] = [];
    const sorted = [...data.expenses].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    for (const e of sorted) {
      const key = `${e.category}|${e.note}|${e.amount}`;
      if (seen.has(key) || e.note === LATTE_NOTE) continue;
      seen.add(key);
      out.push(e);
      if (out.length === 3) break;
    }
    return out;
  }, [data.expenses]);

  const prevWeek = addDays(week.start, -7);
  const prevKey = prevWeek.toISOString();
  const showWrap = prevWeek >= new Date(data.vaultFrom) && data.seenWrap !== prevKey;
  const prevSpent = sumRange(data.expenses, prevWeek, week.start);
  const prevBudget = budgetFor(data.budgets, prevWeek);
  const prevSaved = round2(Math.max(0, prevBudget - prevSpent));

  const messages = MESSAGES[week.mood](data.name);
  const message = messages[(now.getDate() + week.count) % messages.length];
  const lattesLeft = week.left > 0 ? Math.floor(week.left / data.lattePrice) : 0;
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const weekRange = `${fmtShort(week.start)} to ${fmtShort(addDays(week.start, 6))}`;

  /* actions */
  const saveExpense = (e: Expense) => {
    const exists = data.expenses.some(x => x.id === e.id);
    setData(d => ({
      ...d,
      expenses: exists ? d.expenses.map(x => (x.id === e.id ? e : x)) : [...d.expenses, e],
    }));
    setSheet(null);
    setToast({ msg: exists ? 'Changes saved 💖' : 'Spend saved 🎋' });
  };

  const deleteExpense = (id: string) => {
    const removed = data.expenses.find(e => e.id === id);
    if (!removed) return;
    setData(d => ({ ...d, expenses: d.expenses.filter(e => e.id !== id) }));
    setSheet(null);
    setToast({
      msg: 'Spend deleted',
      undo: () => { setData(d => ({ ...d, expenses: [...d.expenses, removed] })); setToast(null); },
    });
  };

  const saveSettings = ({ name, budget, lattePrice }: { name: string; budget: number; lattePrice: number }) => {
    setData(d => {
      const from = week.start.toISOString();
      const budgets = budgetFor(d.budgets, week.start) === budget
        ? d.budgets
        : [...d.budgets.filter(b => b.from !== from), { from, amount: budget }]
            .sort((a, b) => new Date(a.from).getTime() - new Date(b.from).getTime());
      return { ...d, name, lattePrice, budgets };
    });
    setSheet(null);
    setToast({ msg: 'Settings saved 💖' });
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `panda-budget-${toInputDate(now)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (!isAppData(parsed)) throw new Error('bad file');
      setData(parsed);
      setSheet(null);
      setToast({ msg: 'Backup restored 💖' });
    } catch {
      setToast({ msg: "That file doesn't look like a budget backup" });
    }
  };

  const resetAll = () => {
    if (window.confirm('Start over? This deletes every spend and your stash.')) {
      setData(freshData(now));
      setSheet(null);
      setToast({ msg: 'Fresh start 🐼' });
    }
  };

  const editing = sheet?.type === 'edit' ? data.expenses.find(e => e.id === sheet.id) : undefined;

  return (
    <div className="nv-root">
      <style>{STYLES}</style>

      <div className="nv-col">
        <header className="flex items-center justify-between mb-4">
          <div>
            <h1 className="nv-title" style={{ fontSize: 27, fontWeight: 700, lineHeight: 1.1 }}>Hi {data.name}! 🐼</h1>
            <p className="nv-muted" style={{ fontSize: 13.5, fontWeight: 700, marginTop: 2 }}>{greeting}</p>
          </div>
          <button className="nv-iconbtn squish" onClick={() => setSheet({ type: 'settings' })} aria-label="Settings">
            <SettingsIcon size={20} />
          </button>
        </header>

        {tab === 'stats' ? (
          <StatsView stats={stats} vaultEarned={vault.earned} hasData={data.expenses.length > 0} />
        ) : (
          <div className="space-y-4">
            {/* hero: the panda tells her how the week is going */}
            <section className="nv-hero">
              <div className="flex items-center gap-3">
                <div className="nv-bob shrink-0"><Panda mood={week.mood} size={92} /></div>
                <div className="nv-bubble flex-1">{message}</div>
              </div>

              <div style={{ textAlign: 'center', margin: '16px 0 12px' }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: 'rgba(74,44,58,.75)' }}>Left to spend this week</div>
                <div className={`nv-title nv-big ${week.left < 0 ? 'nv-over' : ''}`}>{gbp(week.left)}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(74,44,58,.75)', marginTop: 4 }}>
                  {gbp(week.spent)} spent of {gbp(week.budget)}, {weekRange}
                </div>
              </div>

              <BambooMeter fraction={week.budget > 0 ? week.left / week.budget : 0} dayIdx={week.dayIdx} />

              <div className="grid grid-cols-3 gap-2" style={{ marginTop: 14 }}>
                <div className="nv-mini"><b>{gbp(vault.balance)}</b><span>🎋 Bamboo stash</span></div>
                <div className="nv-mini"><b>{gbp(week.perDay)}</b><span>a day, {week.daysLeft} {week.daysLeft === 1 ? 'day' : 'days'} left</span></div>
                <div className="nv-mini"><b>{lattesLeft}</b><span>☕ lattes left</span></div>
              </div>
            </section>

            {/* last week's wrap-up */}
            {showWrap && (
              <section className="nv-card flex items-center gap-3" style={{ padding: '14px 14px 14px 16px' }}>
                <span style={{ fontSize: 30 }}>{prevSaved > 0 ? '🎉' : '🐼'}</span>
                <div className="flex-1" style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>
                  {prevSaved > 0
                    ? <>Last week you spent {gbp(prevSpent)} of {gbp(prevBudget)}, so <b>{gbp(prevSaved)}</b> went into your Bamboo Stash.</>
                    : <>Last week went over by {gbp(prevSpent - prevBudget)}. New week, fresh start.</>}
                </div>
                <button
                  className="nv-iconbtn squish" style={{ width: 36, height: 36 }} aria-label="Dismiss"
                  onClick={() => setData(d => ({ ...d, seenWrap: prevKey }))}
                >
                  <X size={16} />
                </button>
              </section>
            )}

            {/* breakdown */}
            <section className="nv-card" style={{ padding: 16 }}>
              <div className="nv-seg mb-4" role="tablist" aria-label="Time range">
                <button className={`squish ${timeframe === 'weekly' ? 'on' : ''}`} onClick={() => setTimeframe('weekly')} role="tab" aria-selected={timeframe === 'weekly'}>This week</button>
                <button className={`squish ${timeframe === 'monthly' ? 'on' : ''}`} onClick={() => setTimeframe('monthly')} role="tab" aria-selected={timeframe === 'monthly'}>This month</button>
              </div>

              <div className="relative mx-auto" style={{ width: 190, height: 190 }}>
                <DonutChart totals={scope.catTotals} total={scope.total} />
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center" style={{ pointerEvents: 'none' }}>
                  {scope.total > 0 ? (
                    <>
                      <span className="nv-muted" style={{ fontSize: 13, fontWeight: 800 }}>Spent</span>
                      <span className="nv-title" style={{ fontSize: 32, fontWeight: 700 }}>{gbp(scope.total)}</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 34 }}>🐼</span>
                      <span className="nv-muted" style={{ fontSize: 13, fontWeight: 800 }}>Nothing spent yet</span>
                    </>
                  )}
                </div>
              </div>

              {scope.catTotals.length > 0 && (
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-2" style={{ marginTop: 14 }}>
                  {scope.catTotals.map(([cat, total]) => (
                    <div key={cat} className="flex items-center gap-1.5">
                      <span style={{ width: 10, height: 10, borderRadius: 99, background: catMeta(cat).color }} />
                      <span style={{ fontSize: 12.5, fontWeight: 800 }}>
                        {cat} <span className="nv-muted">{gbp(total)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {scope.stashTotal > 0 && (
                <p className="nv-muted" style={{ fontSize: 12.5, fontWeight: 700, textAlign: 'center', marginTop: 10 }}>
                  Includes {gbp(scope.stashTotal)} paid from the stash
                </p>
              )}
            </section>

            {/* transactions */}
            <section>
              <h3 className="nv-title" style={{ fontSize: 18, fontWeight: 600, padding: '0 6px' }}>Your spends</h3>
              {scope.groups.length === 0 ? (
                <div className="nv-card" style={{ padding: 24, textAlign: 'center', marginTop: 10 }}>
                  <p style={{ fontWeight: 800 }}>No spends logged {timeframe === 'weekly' ? 'this week' : 'this month'} yet.</p>
                  <p className="nv-muted" style={{ fontSize: 13.5, fontWeight: 700, marginTop: 4 }}>Tap the pink + to add one.</p>
                </div>
              ) : (
                scope.groups.map(g => (
                  <div key={g.key}>
                    <div className="nv-daylabel">{g.label}</div>
                    <div className="space-y-2">
                      {g.items.map(exp => {
                        const meta = catMeta(exp.category);
                        return (
                          <div key={exp.id} className="nv-row">
                            <button
                              className="squish flex items-center gap-3 flex-1"
                              style={{ background: 'none', border: 0, textAlign: 'left', padding: 0, color: 'inherit', minWidth: 0 }}
                              onClick={() => setSheet({ type: 'edit', id: exp.id })}
                              aria-label={`Edit ${exp.note || exp.category}, ${gbp(exp.amount)}`}
                            >
                              <span className="nv-tile" style={{ background: `${meta.color}38` }}>{meta.emoji}</span>
                              <span style={{ minWidth: 0 }}>
                                <span style={{ display: 'block', fontWeight: 800, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {exp.note || exp.category}
                                </span>
                                <span className="nv-muted" style={{ display: 'block', fontSize: 12.5, fontWeight: 700 }}>
                                  {exp.category}{exp.fromStash ? ', from stash 🎋' : ''}
                                </span>
                              </span>
                            </button>
                            <span className="nv-title" style={{ fontWeight: 600, fontSize: 17 }}>{gbp(exp.amount)}</span>
                            <button
                              className="squish" aria-label={`Delete ${exp.note || exp.category}`}
                              onClick={() => deleteExpense(exp.id)}
                              style={{ background: 'none', border: 0, color: '#cdaebb', padding: 6, display: 'grid', placeItems: 'center' }}
                            >
                              <Trash2 size={17} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </section>

            {showDev && (
              <button className="nv-link" style={{ width: '100%', color: 'var(--muted)', fontSize: 12 }} onClick={() => setDevDays(d => d + 7)}>
                🛠 Dev: jump forward one week (now +{devDays}d)
              </button>
            )}
          </div>
        )}
      </div>

      {/* bottom tabs + big squishy add button */}
      <nav className="nv-tabbar" aria-label="Main">
        <button className={`nv-tab squish ${tab === 'home' ? 'on' : ''}`} onClick={() => setTab('home')} aria-current={tab === 'home' ? 'page' : undefined}>
          <span className="em">🐼</span>Home
        </button>
        <button className="nv-fab squish" onClick={() => setSheet({ type: 'add' })} aria-label="Add a spend">
          <Plus size={30} strokeWidth={3} />
        </button>
        <button className={`nv-tab squish ${tab === 'stats' ? 'on' : ''}`} onClick={() => setTab('stats')} aria-current={tab === 'stats' ? 'page' : undefined}>
          <span className="em">📊</span>Stats
        </button>
      </nav>

      {sheet?.type === 'add' && (
        <ExpenseSheet
          lattePrice={data.lattePrice} recents={recents} stashBalance={vault.balance}
          now={now} minDate={new Date(data.startedAt)} onSave={saveExpense} onClose={() => setSheet(null)}
        />
      )}
      {editing && (
        <ExpenseSheet
          initial={editing} lattePrice={data.lattePrice} recents={recents} stashBalance={vault.balance}
          now={now} minDate={new Date(data.startedAt)} onSave={saveExpense} onDelete={deleteExpense} onClose={() => setSheet(null)}
        />
      )}
      {sheet?.type === 'settings' && (
        <SettingsSheet
          data={data} currentBudget={week.budget} onSave={saveSettings}
          onExport={exportData} onImport={importData} onReset={resetAll} onClose={() => setSheet(null)}
        />
      )}

      {toast && (
        <div className="nv-toast-wrap" role="status" aria-live="polite">
          <div className="nv-toast">
            <span>{toast.msg}</span>
            {toast.undo && <button onClick={toast.undo}>Undo</button>}
          </div>
        </div>
      )}
    </div>
  );
}
