// Generates assets/space-shooter.svg: a rocket that flies under the GitHub
// contribution graph and shoots down every day that has contributions. The
// score counts up with every hit, and the busiest day of the year is the boss:
// it is fought last and takes several hits.
//
//   GITHUB_TOKEN=... GITHUB_USER=jandolecekk node scripts/space-shooter.mjs
//   node scripts/space-shooter.mjs --sample     (no network, placeholder data)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const C = {
  bg: '#0b1020',
  empty: '#161d38',
  text: '#e6edf3',
  muted: '#7d8aa8',
  purple: '#a78bfa',
  pink: '#f472b6',
  cyan: '#22d3ee',
  levels: ['#161d38', '#43348a', '#7c5ce0', '#c084fc', '#f472b6'],
};
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

const W = 840;
const H = 262;
const PITCH = 14;
const CELL = 11;
const GY = 64; // top of the grid
const SHIP_Y = 212;
const MUZZLE_Y = SHIP_Y - 16;
const SHIP_SPEED = 200; // px per second
const FLIGHT = 0.2; // seconds a bullet needs to reach its target
const BOSS_HP = 6; // hits the busiest day takes (fewer if it has fewer contributions)
const BOSS_DT = 0.3; // seconds between shots at the boss
const HUD_Y = 28; // baseline of the top text row
const CW = 7.8; // width of one 13px monospace character
const LH = 18; // line height of the rolling score digits
const AMBER = '#fbbf24';
const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const r2 = (n) => Math.round(n * 100) / 100;

async function fetchCalendar(login, token) {
  const query = `query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { contributionCount contributionLevel date weekday } }
        }
      }
    }
  }`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'space-shooter' },
    body: JSON.stringify({ query, variables: { login } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors || !json.data?.user) {
    throw new Error(`GitHub API request failed (${res.status}): ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.data.user.contributionsCollection.contributionCalendar;
}

// Placeholder calendar used for local previews and the very first commit.
function sampleCalendar() {
  // week index -> { weekday: level }
  const active = {
    26: { 3: 2 }, 28: { 4: 1 }, 31: { 2: 2, 4: 2 }, 32: { 2: 1, 4: 2 }, 34: { 4: 1 }, 36: { 4: 2 },
    44: { 3: 3, 5: 2 }, 45: { 1: 3, 2: 2, 3: 4, 4: 3, 5: 3 }, 46: { 2: 3, 4: 1 }, 47: { 3: 1 },
    48: { 1: 1, 3: 2, 5: 3 }, 49: { 0: 2, 1: 4, 2: 2, 3: 1, 6: 3 }, 50: { 1: 4, 4: 1, 5: 2, 6: 2 },
    51: { 3: 4, 5: 3, 6: 2 }, 52: { 1: 3 },
  };
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - end.getUTCDay() - 52 * 7);
  const names = Object.keys(LEVEL);
  const counts = [0, 2, 5, 9, 14];
  let total = 0;
  const weeks = [];
  for (let w = 0; w < 53; w++) {
    const contributionDays = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + w * 7 + d);
      if (date > end) break;
      const level = active[w]?.[d] ?? 0;
      const contributionCount = w === 49 && d === 1 ? 34 : counts[level]; // one clear busiest day
      total += contributionCount;
      contributionDays.push({ contributionCount, contributionLevel: names[level], date: date.toISOString().slice(0, 10), weekday: d });
    }
    weeks.push({ contributionDays });
  }
  return { totalContributions: total, weeks };
}

function render(calendar) {
  const weeks = calendar.weeks;
  const cols = weeks.length;
  const GX = r2((W - (cols * PITCH - (PITCH - CELL))) / 2);
  const colX = (c) => GX + c * PITCH;
  const rowY = (r) => GY + r * PITCH;

  // --- targets: every day with contributions, column by column, bottom-up ---
  const all = [];
  weeks.forEach((week, c) => {
    for (const d of week.contributionDays) {
      if (LEVEL[d.contributionLevel] > 0 || d.contributionCount > 0) {
        all.push({ c, r: d.weekday, level: Math.max(1, LEVEL[d.contributionLevel]), count: d.contributionCount ?? 1, date: d.date });
      }
    }
  });
  // The boss is the busiest day (the most recent one on a tie).
  const boss = all.reduce((best, h) => (!best || h.count >= best.count ? h : best), null);
  const bossHp = boss ? Math.max(1, Math.min(BOSS_HP, boss.count)) : 0;
  // Days above the boss in its column wait until it is gone, so no shot passes through it.
  const late = boss ? all.filter((h) => h.c === boss.c && h.r < boss.r).sort((a, b) => b.r - a.r) : [];
  const columns = [];
  for (let c = 0; c < cols; c++) {
    const hits = all.filter((h) => h.c === c && h !== boss && !late.includes(h)).sort((a, b) => b.r - a.r);
    if (hits.length) columns.push({ c, hits });
  }
  const dt = Math.min(0.17, Math.max(0.05, 16 / Math.max(all.length, 1))); // time between shots

  // --- timeline -----------------------------------------------------------
  const stops = [{ t: 0, x: -30 }];
  const events = []; // { t, add } -> score increments
  let t = 0;
  let x = -30;
  for (const col of columns) {
    const cx = colX(col.c) + CELL / 2;
    t += (cx - x) / SHIP_SPEED;
    x = cx;
    stops.push({ t, x, ease: false });
    col.hits.forEach((h, j) => {
      h.fire = t + 0.05 + j * dt;
      h.hit = h.fire + FLIGHT;
      events.push({ t: h.hit, add: h.count });
    });
    t += 0.05 + (col.hits.length - 1) * dt + 0.1;
    stops.push({ t, x, ease: true });
  }
  // Boss fight: fly back to the busiest day and keep firing until it blows up.
  let finaleStart = 0;
  let bossDeath = 0;
  const bossHits = [];
  if (boss) {
    finaleStart = t;
    const bx = colX(boss.c) + CELL / 2;
    t += Math.abs(bx - x) / SHIP_SPEED + 0.25;
    x = bx;
    stops.push({ t, x, ease: false });
    for (let j = 0; j < bossHp; j++) {
      const fire = t + 0.15 + j * BOSS_DT;
      // Split the boss's contributions over its hits so the score still adds up.
      const add = Math.floor((boss.count * (j + 1)) / bossHp) - Math.floor((boss.count * j) / bossHp);
      bossHits.push({ fire, hit: fire + FLIGHT });
      events.push({ t: fire + FLIGHT, add });
    }
    bossDeath = bossHits[bossHp - 1].hit;
    t = bossDeath + 0.45;
    late.forEach((h, j) => {
      h.fire = t + j * dt;
      h.hit = h.fire + FLIGHT;
      events.push({ t: h.hit, add: h.count });
    });
    if (late.length) t += (late.length - 1) * dt + FLIGHT + 0.1;
    stops.push({ t, x, ease: true });
  }
  t += (W + 30 - x) / SHIP_SPEED;
  stops.push({ t, x: W + 30 });
  const respawn = t + 0.4;
  const T = r2(respawn + 2.6); // full loop
  const pct = (s) => r2((s / T) * 100);

  // --- css ----------------------------------------------------------------
  let css = `
    .t { font: 11px ${MONO}; fill: ${C.muted}; }
    .c { animation: ${T}s linear infinite; }
    .b { opacity: 0; fill: ${C.cyan}; animation: ${T}s linear infinite; }
    .x { opacity: 0; fill: #fff7c2; stroke: ${C.pink}; stroke-width: 2; transform-box: fill-box; transform-origin: center; animation: boom ${T}s linear infinite; }
    @keyframes boom { 0% { opacity: 1; transform: scale(.35) } ${pct(0.2)}% { opacity: .9; transform: scale(1.3) } ${pct(0.42)}%, to { opacity: 0; transform: scale(2) } }
    .ship { transform: translateX(${W / 2}px); animation: ship ${T}s linear infinite; }
    .flame { transform-box: fill-box; transform-origin: 50% 0; animation: flame .13s ease-in-out infinite alternate; }
    @keyframes flame { from { transform: scaleY(.55) } to { transform: scaleY(1.15) } }
    .h { font: 13px ${MONO}; fill: ${C.muted}; }
    .s { animation: ${T}s steps(1, end) infinite; }
    .hp { opacity: 0; animation: hp ${T}s linear infinite; }
    .seg { animation: ${T}s linear infinite; }
    .ring { fill: none; stroke: ${AMBER}; stroke-width: 1.5; transform-box: fill-box; transform-origin: center; animation: ring .7s ease-in-out infinite alternate; }
    @keyframes ring { from { transform: scale(1); opacity: 1 } to { transform: scale(1.3); opacity: .35 } }
    .f { opacity: 0; fill: #fff; animation: flash ${T}s linear infinite; }
    @keyframes flash { 0% { opacity: .95 } ${pct(0.2)}%, to { opacity: 0 } }
    .xb { opacity: 0; fill: none; stroke-width: 3; transform-box: fill-box; transform-origin: center; animation: bigboom ${T}s linear infinite; }
    @keyframes bigboom { 0% { opacity: 1; transform: scale(.4) } ${pct(0.7)}%, to { opacity: 0; transform: scale(5) } }
    .stars { animation: stars 26s linear infinite; }
    @keyframes stars { from { transform: translateY(0) } to { transform: translateY(${H}px) } }`;

  css += `
    @keyframes ship { ${stops
      .map((s, i) => `${i === stops.length - 1 ? `${pct(s.t)}%, to` : `${pct(s.t)}%`} { transform: translateX(${r2(s.x)}px)${s.ease ? '; animation-timing-function: ease-in-out' : ''} }`)
      .join(' ')} }`;

  for (let r = 0; r < 7; r++) {
    const d = r2(MUZZLE_Y - (rowY(r) + CELL / 2));
    css += `
    @keyframes b${r} { 0% { opacity: 1; transform: translateY(0) } ${pct(FLIGHT)}% { opacity: 1; transform: translateY(-${d}px) } ${r2(pct(FLIGHT) + 0.01)}%, to { opacity: 0; transform: translateY(-${d}px) } }`;
  }

  // --- cells, bullets, explosions ------------------------------------------
  let cells = '';
  let bullets = '';
  let booms = '';
  const bullet = (h, fire, colour) =>
    `<rect class="b" x="${r2(colX(h.c) + CELL / 2 - 1.5)}" y="${MUZZLE_Y - 9}" width="3" height="9" rx="1.5" style="animation-name:b${h.r};animation-delay:${r2(fire)}s${colour ? `;fill:${colour}` : ''}"/>`;
  const boom = (h, at) => `<circle class="x" cx="${r2(colX(h.c) + CELL / 2)}" cy="${rowY(h.r) + CELL / 2}" r="6" style="animation-delay:${r2(at)}s"/>`;
  // One cell that is visible until `gone`, then grows back (left to right) after the run.
  const lifeCss = (name, h, gone) => {
    const back = respawn + (h.c / cols) * 0.7;
    return `
    @keyframes ${name} { 0%, ${pct(gone)}% { opacity: 1 } ${r2(pct(gone) + 0.15)}%, ${pct(back)}% { opacity: 0 } ${pct(back + 0.45)}%, to { opacity: 1 } }`;
  };
  let i = 0;
  for (const h of [...columns.flatMap((col) => col.hits), ...late]) {
    css += lifeCss(`k${i}`, h, h.hit);
    cells += `<rect class="c" x="${r2(colX(h.c))}" y="${rowY(h.r)}" width="${CELL}" height="${CELL}" rx="2.5" fill="${C.levels[h.level]}" style="animation-name:k${i}"/>`;
    bullets += bullet(h, h.fire);
    booms += boom(h, h.hit);
    i++;
  }

  let bossHud = '';
  let bossNote = '';
  if (boss) {
    const bx = r2(colX(boss.c));
    const by = rowY(boss.r);
    css += lifeCss('kb', boss, bossDeath);
    cells += `<g class="c" style="animation-name:kb"><rect x="${bx}" y="${by}" width="${CELL}" height="${CELL}" rx="2.5" fill="${C.levels[boss.level]}"/><rect class="ring" x="${bx - 3}" y="${by - 3}" width="${CELL + 6}" height="${CELL + 6}" rx="4.5"/></g>`;
    bossHits.forEach((b, j) => {
      bullets += bullet(boss, b.fire, AMBER);
      booms += boom(boss, b.hit);
      if (j < bossHp - 1) booms += `<rect class="f" x="${bx}" y="${by}" width="${CELL}" height="${CELL}" rx="2.5" style="animation-delay:${r2(b.hit)}s"/>`;
    });
    [AMBER, C.pink, '#fff'].forEach((col, j) => {
      booms += `<circle class="xb" cx="${r2(bx + CELL / 2)}" cy="${by + CELL / 2}" r="8" stroke="${col}" style="animation-delay:${r2(bossDeath + j * 0.1)}s"/>`;
    });

    // HP bar in the top row, only visible during the boss fight.
    css += `
    @keyframes hp { 0%, ${pct(finaleStart)}% { opacity: 0 } ${pct(finaleStart + 0.3)}%, ${pct(bossDeath + 0.5)}% { opacity: 1 } ${pct(bossDeath + 0.9)}%, to { opacity: 0 } }`;
    const hx = GX + 290;
    let segs = '';
    bossHits.forEach((b, j) => {
      const k = bossHp - 1 - j; // the bar empties from the right
      css += `
    @keyframes h${j} { 0%, ${pct(b.hit)}% { opacity: 1 } ${r2(pct(b.hit) + 0.1)}%, to { opacity: .15 } }`;
      segs += `<rect class="seg" x="${r2(hx + 5 * CW + k * 14)}" y="${HUD_Y - 9}" width="11" height="9" rx="2" fill="${AMBER}" style="animation-name:h${j}"/>`;
    });
    bossHud = `<g class="hp"><text class="h" x="${hx}" y="${HUD_Y}" style="fill:${AMBER};font-weight:600">BOSS</text>${segs}</g>`;
    const [, bm, bd] = boss.date.split('-').map(Number);
    bossNote = `<text class="t" x="${GX}" y="${H - 14}"><tspan fill="${AMBER}">Boss</tspan> = busiest day: ${MONTHS[bm - 1]} ${bd} · ${boss.count} contribution${boss.count === 1 ? '' : 's'}</text>`;
  }

  // --- score: one strip of 0-9 per digit, stepped up at every hit ------------
  const digits = Math.max(6, String(calendar.totalContributions).length);
  const right = colX(cols - 1) + CELL;
  const hiX = right - digits * CW;
  const scoreX = hiX - (9 + 3 + digits) * CW; // "HI-SCORE " + gap + score digits
  events.sort((a, b) => a.t - b.t);
  let scoreStrips = '';
  for (let d = 0; d < digits; d++) {
    const frames = new Map([[0, 0]]); // percent -> digit shown from then on
    let sum = 0;
    let prev = 0;
    for (const e of events) {
      sum += e.add;
      const v = Math.floor(sum / 10 ** (digits - 1 - d)) % 10;
      if (v !== prev) frames.set(pct(e.t), v);
      prev = v;
    }
    css += `
    @keyframes s${d} { ${[...frames].map(([p, v]) => `${p}% { transform: translateY(${-v * LH}px) }`).join(' ')} to { transform: translateY(${-prev * LH}px) } }`;
    const x0 = r2(scoreX + d * CW);
    scoreStrips += `<text class="h s" style="animation-name:s${d};fill:${C.cyan};font-weight:600">${[...Array(10).keys()].map((n) => `<tspan x="${x0}" y="${HUD_Y + n * LH}">${n}</tspan>`).join('')}</text>`;
  }
  const label = (text, x) => `<text class="h" x="${r2(x)}" y="${HUD_Y}" textLength="${r2(text.length * CW)}" lengthAdjust="spacing">${text}</text>`;
  const hud = `
    ${label('SCORE', scoreX - 6 * CW)}
    <g clip-path="url(#score)">${scoreStrips}</g>
    ${label('HI-SCORE', hiX - 9 * CW)}
    <text class="h" x="${r2(hiX)}" y="${HUD_Y}" textLength="${r2(digits * CW)}" lengthAdjust="spacing" style="fill:${C.pink};font-weight:600">${String(calendar.totalContributions).padStart(digits, '0')}</text>
    ${bossHud}`;

  css += `
    @media (prefers-reduced-motion: reduce) {
      .c, .b, .x, .ship, .flame, .stars, .s, .hp, .seg, .ring, .f, .xb { animation: none !important; }
    }`;

  // --- static bits --------------------------------------------------------
  // Empty grid: one tiled rect for the full weeks, one for the (partial) last week.
  const lastDays = weeks[cols - 1].contributionDays.length;
  const firstSkip = 7 - weeks[0].contributionDays.length; // first week can start mid-week
  const grid = `
    <rect x="${r2(colX(1))}" y="${GY}" width="${(cols - 2) * PITCH}" height="${7 * PITCH}" fill="url(#cell)"/>
    <rect x="${GX}" y="${rowY(firstSkip)}" width="${PITCH}" height="${(7 - firstSkip) * PITCH}" fill="url(#cell)"/>
    <rect x="${r2(colX(cols - 1))}" y="${GY}" width="${PITCH}" height="${lastDays * PITCH}" fill="url(#cell)"/>`;

  // Month labels; a month that only has a sliver of a column or two is skipped.
  const starts = [];
  weeks.forEach((week, c) => {
    const m = Number(week.contributionDays[0].date.slice(5, 7)) - 1;
    if (!starts.length || starts[starts.length - 1].m !== m) starts.push({ m, c });
  });
  const months = starts
    .filter((s, i) => (starts[i + 1]?.c ?? cols) - s.c >= 3)
    .map((s) => `<text class="t" x="${r2(colX(s.c))}" y="${GY - 9}">${MONTHS[s.m]}</text>`)
    .join('');
  const days = [1, 3, 5].map((r) => `<text class="t" x="${r2(GX - 8)}" y="${rowY(r) + 9}" text-anchor="end">${['Mon', 'Wed', 'Fri'][(r - 1) / 2]}</text>`).join('');

  // Deterministic star field, drawn twice so it can scroll seamlessly.
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  let starField = '';
  for (let s = 0; s < 46; s++) {
    starField += `<circle cx="${r2(rand() * W)}" cy="${r2(rand() * H)}" r="${r2(0.5 + rand() * 0.9)}" opacity="${r2(0.15 + rand() * 0.5)}"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="A rocket shooting down the contribution graph: ${calendar.totalContributions} contributions in the last year">
  <title>${calendar.totalContributions} contributions in the last year</title>
  <defs>
    <linearGradient id="border" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.purple}"/>
      <stop offset=".5" stop-color="${C.pink}"/>
      <stop offset="1" stop-color="${C.cyan}"/>
      <animateTransform attributeName="gradientTransform" type="rotate" from="0 .5 .5" to="360 .5 .5" dur="8s" repeatCount="indefinite"/>
    </linearGradient>
    <pattern id="cell" patternUnits="userSpaceOnUse" x="${GX}" y="${GY}" width="${PITCH}" height="${PITCH}">
      <rect width="${CELL}" height="${CELL}" rx="2.5" fill="${C.empty}"/>
    </pattern>
    <clipPath id="score"><rect x="${r2(scoreX - 1)}" y="${HUD_Y - 13}" width="${r2(digits * CW + 2)}" height="17"/></clipPath>
    <clipPath id="card"><rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="14"/></clipPath>
  </defs>
  <style>${css}
  </style>

  <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="14" fill="${C.bg}"/>
  <g clip-path="url(#card)">
    <g class="stars" fill="${C.text}"><g>${starField}</g><g transform="translate(0,${-H})">${starField}</g></g>
    <text class="h" x="${GX}" y="${HUD_Y}"><tspan fill="${C.text}" font-weight="600">${calendar.totalContributions}</tspan> contributions in the last year</text>
    ${hud}
    ${bossNote}
    ${months}${days}${grid}
    ${cells}
    ${bullets}
    ${booms}
    <g transform="translate(0,${SHIP_Y})">
      <g class="ship">
        <path class="flame" d="M-4,9 Q0,26 4,9Z" fill="#fbbf24"/>
        <path class="flame" d="M-2,9 Q0,18 2,9Z" fill="#fff"/>
        <path d="M-5,1 L-11,11 L-5,8Z M5,1 L11,11 L5,8Z" fill="${C.pink}"/>
        <path d="M0,-15 C6,-9 6.5,2 5,9 L-5,9 C-6.5,2 -6,-9 0,-15Z" fill="${C.text}"/>
        <path d="M0,-15 C2.6,-12.4 3.9,-10 4.6,-7.5 L-4.6,-7.5 C-3.9,-10 -2.6,-12.4 0,-15Z" fill="${C.purple}"/>
        <circle cy="-2" r="2.6" fill="${C.cyan}" stroke="${C.bg}"/>
      </g>
    </g>
  </g>
  <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="14" fill="none" stroke="url(#border)" stroke-width="2"/>
</svg>
`;
}

const sample = process.argv.includes('--sample');
const login = process.env.GITHUB_USER || process.env.GITHUB_REPOSITORY_OWNER;
const token = process.env.GITHUB_TOKEN;
if (!sample && (!login || !token)) {
  console.error('Set GITHUB_TOKEN and GITHUB_USER, or pass --sample for placeholder data.');
  process.exit(1);
}
const calendar = sample ? sampleCalendar() : await fetchCalendar(login, token);
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'space-shooter.svg'), render(calendar));
console.log(`Wrote assets/space-shooter.svg (${calendar.totalContributions} contributions${sample ? ', sample data' : ''})`);
