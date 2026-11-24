// Generates assets/space-shooter.svg: a rocket that flies under the GitHub
// contribution graph and shoots down every day that has contributions. The
// score counts up with every hit, and the busiest day of the year is the boss:
// it is fought last and takes several hits. When it blows up, the profile
// picture jumps out of it and runs across the graph until the rocket rams it.
//
//   GITHUB_TOKEN=... GITHUB_USER=jandolecekk node scripts/space-shooter.mjs
//   node scripts/space-shooter.mjs --sample     (no network, placeholder data)
//   node scripts/space-shooter.mjs --sample --avatar me.png
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
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
const BOSS_HP = 10; // hits the busiest day takes (fewer if it has fewer contributions)
const BOSS_DT = 0.34; // seconds between shots at the boss
const BANNER = 1.6; // seconds the BOSS FIGHT banner stays up before the fight starts
const HUD_Y = 28; // baseline of the top text row
const CW = 7.8; // width of one 13px monospace character
const LH = 18; // line height of the rolling score digits
const AMBER = '#fbbf24';
const AV_R = 19; // radius of the runaway profile picture
const AV_SPEED = 235; // px per second while it runs
// Shown after the rocket catches the profile picture; one pair per day, in turn.
const TAUNTS = [
  ["HAHA, THAT'S IT?", 'YOU NEED MORE CONTRIBUTIONS'],
  ['TOO EASY!', 'COME BACK WITH MORE COMMITS'],
  ['GAME OVER', 'PUSH MORE CODE, HUMAN'],
];
// 5x7 pixel font, one string of 35 bits per glyph (rows top to bottom).
const FONT = {
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110', C: '01110100011000010000100001000101110',
  D: '11110100011000110001100011000111110', E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000',
  G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001', I: '11111001000010000100001000010011111',
  J: '00111000100001000010000101001001100', K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001110011010110011100011000110001', O: '01110100011000110001100011000101110',
  P: '11110100011000111110100001000010000', Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100', U: '10001100011000110001100011000101110',
  V: '10001100011000110001100010101000100', W: '10001100011000110101101011101110001', X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100', Z: '11111000010001000100010001000011111',
  '?': '01110100010000100010001000000000100', '!': '00100001000010000100001000000000100', ',': '00000000000000000000001100010001000',
  '.': '00000000000000000000000000011000110', "'": '00100001000100000000000000000000000', ' ': '00000000000000000000000000000000000',
};
/** Text drawn as square pixels (one <path>), horizontally centred on `cx`. */
function pixelText(text, cx, y, px, fill, extra = '') {
  const chars = [...text.toUpperCase()];
  const width = (chars.length * 6 - 1) * px;
  let d = '';
  chars.forEach((ch, i) => {
    const bits = FONT[ch] ?? FONT[' '];
    for (let r = 0; r < 7; r++) {
      let c = 0;
      while (c < 5) {
        if (bits[r * 5 + c] !== '1') { c++; continue; }
        let run = 1;
        while (c + run < 5 && bits[r * 5 + c + run] === '1') run++;
        d += `M${r2(cx - width / 2 + (i * 6 + c) * px)},${r2(y + r * px)}h${r2(run * px)}v${px}h${r2(-run * px)}z`;
        c += run;
      }
    }
  });
  return `<path d="${d}" fill="${fill}" shape-rendering="crispEdges"${extra}/>`;
}
const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const r2 = (n) => Math.round(n * 100) / 100;

async function fetchCalendar(login, token) {
  const query = `query($login: String!) {
    user(login: $login) {
      avatarUrl(size: 32)
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
  const calendar = json.data.user.contributionsCollection.contributionCalendar;
  // The picture has to be embedded: an SVG shown on GitHub cannot load other images.
  try {
    const img = await fetch(json.data.user.avatarUrl);
    if (!img.ok) throw new Error(`HTTP ${img.status}`);
    const type = img.headers.get('content-type') || 'image/png';
    calendar.avatar = `data:${type};base64,${Buffer.from(await img.arrayBuffer()).toString('base64')}`;
  } catch (err) {
    console.warn(`Could not load the profile picture (${err.message}); using the built-in sprite.`);
  }
  return calendar;
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
    // The ship flies back under the boss while the banner is up; the fight starts when it clears.
    t = Math.max(t + Math.abs(bx - x) / SHIP_SPEED + 0.25, finaleStart + BANNER);
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
    t = bossDeath + 0.8;
    late.forEach((h, j) => {
      h.fire = t + j * dt;
      h.hit = h.fire + FLIGHT;
      events.push({ t: h.hit, add: h.count });
    });
    if (late.length) t += (late.length - 1) * dt + FLIGHT + 0.1;
  }

  // Chase: the profile picture jumps out of the dead boss and zig-zags across the empty graph.
  // The rocket follows underneath and misses, then turns, climbs and rams it.
  const chase = boss ? {} : null;
  if (chase) {
    const start = { x: colX(boss.c) + CELL / 2, y: rowY(boss.r) + CELL / 2 };
    chase.pop = bossDeath + 0.2;
    chase.run = Math.max(t, bossDeath + 1.5);
    stops.push({ t: chase.run, x });
    const dir = start.x > W / 2 ? -1 : 1; // run towards the far side
    const endX = dir < 0 ? GX + 80 : W - GX - 80;
    const rows = [5, 1, 6, 2, 5, 0, 4, 1, 6, 2];
    chase.way = [{ t: chase.run, ...start }];
    chase.misses = [];
    let p = start;
    let pt = chase.run;
    for (let k = 0; Math.abs(endX - p.x) > 1; k++) {
      const left = Math.abs(endX - p.x);
      const last = left <= 175;
      const n = { x: last ? endX : p.x + dir * 115, y: rowY(last ? 3 : rows[k % rows.length]) + CELL / 2 };
      pt += Math.hypot(n.x - p.x, n.y - p.y) / AV_SPEED;
      chase.way.push({ t: pt, ...n });
      if (!last) {
        // The rocket gets under each spot a moment too late and fires at thin air.
        stops.push({ t: pt + 0.22, x: n.x });
        chase.misses.push({ t: pt + 0.24, x: n.x });
      }
      p = n;
    }
    chase.end = p; // cornered here
    const sx = p.x - dir * 95;
    const angle = r2((Math.atan2(p.x - sx, SHIP_Y - p.y) * 180) / Math.PI);
    stops.push({ t: pt + 0.3, x: sx, ease: true });
    stops.push({ t: pt + 0.65, x: sx, rot: angle, easeIn: true }); // turn towards it
    chase.hit = pt + 1.0;
    stops.push({ t: chase.hit, x: p.x, y: p.y - SHIP_Y, rot: angle });
    // ...and keep going straight out of the card.
    const far = 520;
    stops.push({ t: chase.hit + 0.9, x: p.x + Math.sin((angle * Math.PI) / 180) * far, y: p.y - SHIP_Y - Math.cos((angle * Math.PI) / 180) * far, rot: angle });
    chase.taunt = chase.hit + 0.6;
    chase.tauntEnd = chase.taunt + 3.4;
    t = chase.tauntEnd;
  } else {
    t += (W + 30 - x) / SHIP_SPEED;
    stops.push({ t, x: W + 30 });
  }
  const respawn = t + 0.3;
  const T = r2(respawn + (chase ? 1.9 : 2.6)); // full loop
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
    @keyframes bigboom { 0% { opacity: 1; transform: scale(.4) } ${pct(0.9)}%, to { opacity: 0; transform: scale(8) } }
    .grow { transform-box: fill-box; transform-origin: center; animation: grow ${T}s ease-in-out infinite; }
    .band { opacity: 0; animation: band ${T}s linear infinite; }
    .banner { opacity: 0; transform-box: fill-box; transform-origin: center; animation: banner ${T}s linear infinite; }
    .blink2 { animation: blink2 .3s steps(1) infinite; }
    @keyframes blink2 { 0% { opacity: 1 } 50% { opacity: .72 } }
    .sf { opacity: 0; fill: #fff; animation: sf ${T}s linear infinite; }
    @keyframes sf { 0% { opacity: .45 } ${pct(0.35)}%, to { opacity: 0 } }
    .pts { opacity: 0; font: 700 16px ${MONO}; fill: ${AMBER}; animation: pts ${T}s ease-out infinite; }
    @keyframes pts { 0% { opacity: 1; transform: translateY(0) } ${pct(1.3)}% { opacity: 1; transform: translateY(-26px) } ${pct(1.7)}%, to { opacity: 0; transform: translateY(-30px) } }
    .stars { animation: stars 26s linear infinite; }
    @keyframes stars { from { transform: translateY(0) } to { transform: translateY(${H}px) } }`;

  css += `
    @keyframes ship { ${stops
      .map((s, i) => `${i === stops.length - 1 ? `${pct(s.t)}%, to` : `${pct(s.t)}%`} { transform: translate(${r2(s.x)}px, ${r2(s.y ?? 0)}px) rotate(${s.rot ?? 0}deg)${s.ease ? '; animation-timing-function: ease-in-out' : s.easeIn ? '; animation-timing-function: ease-in' : ''} }`)
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
  let bossCell = '';
  let banner = '';
  if (boss) {
    const bx = r2(colX(boss.c));
    const by = rowY(boss.r);
    css += lifeCss('kb', boss, bossDeath);
    const [, bm, bd] = boss.date.split('-').map(Number);
    const bossDay = `${MONTHS[bm - 1]} ${bd} · ${boss.count} contribution${boss.count === 1 ? '' : 's'}`;
    // The boss swells to double size when the fight starts and flashes white on every hit.
    css += `
    @keyframes grow { 0%, ${pct(finaleStart + 0.2)}% { transform: scale(1) } ${pct(finaleStart + 0.9)}%, ${pct(bossDeath + 0.3)}% { transform: scale(2.2) } ${pct(bossDeath + 0.5)}%, to { transform: scale(1) } }
    @keyframes band { 0%, ${pct(finaleStart)}% { opacity: 0 } ${pct(finaleStart + 0.15)}%, ${pct(finaleStart + BANNER - 0.3)}% { opacity: 1 } ${pct(finaleStart + BANNER)}%, to { opacity: 0 } }
    @keyframes banner { 0%, ${pct(finaleStart)}% { opacity: 0; transform: scale(1.7) } ${pct(finaleStart + 0.2)}%, ${pct(finaleStart + BANNER - 0.3)}% { opacity: 1; transform: scale(1) } ${pct(finaleStart + BANNER)}%, to { opacity: 0; transform: scale(.94) } }`;
    let flashes = '';
    bossHits.forEach((b, j) => {
      bullets += bullet(boss, b.fire, AMBER);
      booms += boom(boss, b.hit);
      if (j < bossHp - 1) flashes += `<rect class="f" x="${bx}" y="${by}" width="${CELL}" height="${CELL}" rx="2.5" style="animation-delay:${r2(b.hit)}s"/>`;
    });
    bossCell = `<g class="c" style="animation-name:kb"><g class="grow"><rect x="${bx}" y="${by}" width="${CELL}" height="${CELL}" rx="2.5" fill="${C.levels[boss.level]}"/><rect class="ring" x="${bx - 3}" y="${by - 3}" width="${CELL + 6}" height="${CELL + 6}" rx="4.5"/>${flashes}</g></g>`;
    [AMBER, C.pink, '#fff', AMBER, C.cyan].forEach((col, j) => {
      booms += `<circle class="xb" cx="${r2(bx + CELL / 2)}" cy="${by + CELL / 2}" r="8" stroke="${col}" style="animation-delay:${r2(bossDeath + j * 0.12)}s"/>`;
    });
    booms += `<rect class="sf" x="0" y="0" width="${W}" height="${H}" style="animation-delay:${r2(bossDeath)}s"/>`;
    booms += `<text class="pts" x="${r2(Math.min(bx + CELL / 2, W - 60))}" y="${by - 8}" text-anchor="middle" style="animation-delay:${r2(bossDeath)}s">+${boss.count}</text>`;

    // BOSS FIGHT banner across the graph, shown before the first shot.
    const mid = GY + (7 * PITCH - (PITCH - CELL)) / 2;
    banner = `<rect class="band" x="0" y="${GY - 3}" width="${W}" height="${7 * PITCH + 6}" fill="${C.bg}" fill-opacity=".82"/>
    <g class="banner"><g class="blink2">
      <text x="${W / 2}" y="${r2(mid + 8)}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="46" font-weight="900" letter-spacing="6" fill="${AMBER}" stroke="${C.pink}" stroke-width="1.2" paint-order="stroke">BOSS FIGHT</text>
      <text class="h" x="${W / 2}" y="${r2(mid + 32)}" text-anchor="middle" style="fill:${C.text}">busiest day · ${bossDay}</text>
    </g></g>`;

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
    bossNote = `<text class="t" x="${GX}" y="${H - 14}"><tspan fill="${AMBER}">Boss</tspan> = busiest day: ${bossDay}</text>`;
  }

  // --- chase: runaway profile picture, missed shots, the ram, the taunt -------
  let runner = '';
  let taunt = '';
  if (chase) {
    const { way, end } = chase;
    css += `
    .av { animation: av ${T}s linear infinite; }
    @keyframes av { 0%, ${way.map((w, i) => `${i === way.length - 1 ? `${pct(w.t)}%, to` : `${pct(w.t)}%`} { transform: translate(${r2(w.x)}px, ${r2(w.y)}px) }`).join(' ')} }
    .avv { opacity: 0; animation: avv ${T}s linear infinite; }
    @keyframes avv { 0%, ${pct(chase.pop)}% { opacity: 0 } ${r2(pct(chase.pop) + 0.05)}%, ${pct(chase.hit + 0.16)}% { opacity: 1 } ${pct(chase.hit + 0.22)}%, to { opacity: 0 } }
    .avs { animation: avs ${T}s ease-out infinite; }
    @keyframes avs { 0%, ${pct(chase.pop)}% { transform: scale(0) } ${pct(chase.pop + 0.25)}% { transform: scale(1.35) } ${pct(chase.pop + 0.42)}%, ${pct(chase.hit)}% { transform: scale(1) } ${pct(chase.hit + 0.1)}%, to { transform: scale(1.8, .1) } }
    .hop { animation: hop .2s ease-in-out infinite alternate; }
    @keyframes hop { from { transform: translateY(1px) rotate(-5deg) } to { transform: translateY(-3px) rotate(5deg) } }
    .say { opacity: 0; animation: say ${T}s linear infinite; }
    @keyframes say { 0%, ${pct(chase.pop + 0.4)}% { opacity: 0 } ${pct(chase.pop + 0.5)}%, ${pct(chase.run + 0.5)}% { opacity: 1 } ${pct(chase.run + 0.7)}%, to { opacity: 0 } }
    @keyframes bm { 0% { opacity: 1; transform: translateY(0) } ${pct(0.32)}% { opacity: 1; transform: translateY(-${MUZZLE_Y - GY + 14}px) } ${r2(pct(0.32) + 0.01)}%, to { opacity: 0; transform: translateY(-${MUZZLE_Y - GY + 14}px) } }
    .taunt { opacity: 0; transform-box: fill-box; transform-origin: center; animation: taunt ${T}s linear infinite; }
    @keyframes taunt { 0%, ${pct(chase.taunt)}% { opacity: 0; transform: scale(.6) } ${pct(chase.taunt + 0.12)}% { opacity: 1; transform: scale(1.08) } ${pct(chase.taunt + 0.22)}%, ${pct(chase.tauntEnd - 0.25)}% { opacity: 1; transform: scale(1) } ${pct(chase.tauntEnd)}%, to { opacity: 0; transform: scale(1) } }`;

    for (const m of chase.misses) {
      bullets += `<rect class="b" x="${r2(m.x - 1.5)}" y="${MUZZLE_Y - 9}" width="3" height="9" rx="1.5" style="animation-name:bm;animation-delay:${r2(m.t)}s"/>`;
    }
    // The catch: shock waves and a flash where the picture was cornered.
    [C.pink, '#fff', AMBER, C.cyan, C.pink].forEach((col, j) => {
      booms += `<circle class="xb" cx="${r2(end.x)}" cy="${r2(end.y)}" r="8" stroke="${col}" style="animation-delay:${r2(chase.hit + j * 0.1)}s"/>`;
    });
    booms += `<rect class="sf" x="0" y="0" width="${W}" height="${H}" style="animation-delay:${r2(chase.hit)}s"/>`;

    const R = AV_R;
    const face = calendar.avatar
      ? `<image href="${calendar.avatar}" x="${-R}" y="${-R}" width="${2 * R}" height="${2 * R}" clip-path="url(#face)" style="image-rendering:pixelated"/>`
      : // Built-in sprite for when the picture could not be loaded.
        `<circle r="${R}" fill="#24292f"/><circle r="${R - 5}" cy="2" fill="#f0f6fc"/><path d="M-11,-4h9v2h-1v2h-1v2h-5v-2h-1v-2h-1zM2,-4h9v2h-1v2h-1v2h-5v-2h-1v-2h-1zM-2,-4h4v2h-4z" fill="#0b1020" shape-rendering="crispEdges"/>`;
    // The speech bubble goes below the picture when it starts in the top rows.
    const sayY = boss.r < 3 ? R + 6 : -R - 24;
    runner = `<g class="av"><g class="avv">
      <g class="avs"><g class="hop">${face}<circle r="${R}" fill="none" stroke="#fff" stroke-width="1.5"/></g></g>
      <g class="say"><rect x="-58" y="${sayY}" width="116" height="20" fill="#fff" shape-rendering="crispEdges"/>${pixelText('CATCH ME!', 0, sayY + 3, 2, C.bg)}</g>
    </g></g>`;

    const lastDay = weeks[cols - 1].contributionDays.at(-1).date;
    const dayOfYear = Math.floor((Date.parse(lastDay) - Date.parse(`${lastDay.slice(0, 4)}-01-01`)) / 86400000);
    const [big, small] = TAUNTS[dayOfYear % TAUNTS.length];
    const ty = GY + 4;
    const tw = Math.max((big.length * 6 - 1) * 4, (small.length * 6 - 1) * 2) + 44;
    taunt = `<g class="taunt">
      <rect x="${r2(W / 2 - tw / 2)}" y="${ty}" width="${tw}" height="86" fill="${C.bg}" stroke="${AMBER}" stroke-width="4" shape-rendering="crispEdges"/>
      <rect x="${r2(W / 2 - tw / 2 + 7)}" y="${ty + 7}" width="${tw - 14}" height="72" fill="none" stroke="${C.pink}" stroke-width="2" shape-rendering="crispEdges"/>
      ${pixelText(big, W / 2, ty + 20, 4, AMBER)}
      ${pixelText(small, W / 2, ty + 58, 2, C.text, ' class="blink2"')}
    </g>`;
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
      .c, .b, .x, .ship, .flame, .stars, .s, .hp, .seg, .ring, .f, .xb, .grow, .band, .banner, .blink2, .sf, .pts, .av, .avv, .avs, .hop, .say, .taunt { animation: none !important; }
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
    <clipPath id="face"><circle r="${AV_R}"/></clipPath>
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
    ${banner}
    ${bossCell}
    ${bullets}
    ${runner}
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
    ${taunt}
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
const avatarArg = process.argv.indexOf('--avatar');
if (avatarArg > -1) calendar.avatar = `data:image/png;base64,${readFileSync(process.argv[avatarArg + 1]).toString('base64')}`;
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'space-shooter.svg'), render(calendar));
console.log(`Wrote assets/space-shooter.svg (${calendar.totalContributions} contributions${sample ? ', sample data' : ''})`);
