// Generates assets/header.svg and assets/footer.svg.
// Edit `config` below, then run:  node scripts/build.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const config = {
  title: 'jandolecekk — zsh',
  // Each step: a command that gets "typed", followed by its output.
  commands: ['whoami', 'cat status.txt', 'vibe --loop'],
  headline: "Hey, I'm Jan",
  // Output of the 2nd command. `c` picks an accent colour (optional).
  status: [
    { t: 'just vibin', c: 'pink' },
    { t: '  ·  Brno, CZ  ·  building AI things @ ' },
    { t: 'Bloomreach', c: 'cyan' },
  ],
  cycle: 16, // seconds before the whole animation loops
};

const C = {
  bg: '#0b1020',
  bar: '#111831',
  line: '#1f2a4a',
  text: '#e6edf3',
  muted: '#7d8aa8',
  green: '#3fb950',
  purple: '#a78bfa',
  pink: '#f472b6',
  cyan: '#22d3ee',
};

const W = 840;
const H = 340;
const CH = 9.6; // width of one monospace character at 16px
const X0 = 28; // left padding
const XT = X0 + 2 * CH; // where typed text starts (after "$ ")
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// Small seeded PRNG so the output is identical on every build.
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r2 = (n) => Math.round(n * 100) / 100;

function header() {
  const rand = rng(7);
  const pct = (t) => r2((t / config.cycle) * 100);

  // --- timeline -----------------------------------------------------------
  const baselines = [78, 172, 244];
  let t = 0.5;
  const steps = config.commands.map((cmd, i) => {
    const show = t;
    const typeStart = show + 0.15;
    const typeEnd = typeStart + cmd.length * 0.1;
    const outStart = typeEnd + 0.3;
    const outEnd = outStart + 0.35;
    t = outStart + 0.95;
    return { cmd, i, y: baselines[i], show, typeStart, typeEnd, outStart, outEnd };
  });

  // --- css ----------------------------------------------------------------
  let css = `
    .mono { font: 16px ${MONO}; }
    .anim { animation-duration: ${config.cycle}s; animation-iteration-count: infinite; animation-timing-function: linear; }
    .all { animation-name: all; }
    @keyframes all { 0% { opacity: 0 } 2% { opacity: 1 } 96% { opacity: 1 } 100% { opacity: 0 } }
    .blink { animation: blink 1s steps(1) infinite; }
    @keyframes blink { 0% { opacity: 1 } 50% { opacity: 0 } }
    .cover { opacity: 0; }
    .bar { transform-box: fill-box; transform-origin: 50% 100%; animation: eq 1s ease-in-out infinite alternate; }
    @keyframes eq { from { transform: scaleY(.12) } to { transform: scaleY(1) } }
    .star { animation: twinkle 3s ease-in-out infinite alternate; }
    @keyframes twinkle { from { opacity: .08 } to { opacity: .9 } }
    .glow-a { animation: drift-a 11s ease-in-out infinite alternate; }
    .glow-b { animation: drift-b 13s ease-in-out infinite alternate; }
    @keyframes drift-a { from { transform: translate(0, 0) } to { transform: translate(-70px, 30px) } }
    @keyframes drift-b { from { transform: translate(0, 0) } to { transform: translate(60px, -24px) } }`;

  steps.forEach((s, i) => {
    const next = steps[i + 1];
    const w = r2(s.cmd.length * CH);
    css += `
    .show${i} { animation-name: show${i}; }
    @keyframes show${i} { 0%, ${pct(s.show)}% { opacity: 0 } ${r2(pct(s.show) + 0.01)}%, 100% { opacity: 1 } }
    .type${i} { opacity: 1; animation-name: type${i}; }
    @keyframes type${i} { 0%, ${pct(s.typeStart)}% { transform: translateX(0); animation-timing-function: steps(${s.cmd.length}, end) } ${pct(s.typeEnd)}%, 100% { transform: translateX(${w}px) } }
    .out${i} { animation-name: out${i}; }
    @keyframes out${i} { 0%, ${pct(s.outStart)}% { opacity: 0; transform: translateY(8px) } ${pct(s.outEnd)}%, 100% { opacity: 1; transform: translateY(0) } }`;
    if (next) {
      css += `
    .cur${i} { animation-name: cur${i}; }
    @keyframes cur${i} { 0%, ${pct(next.show)}% { opacity: 1 } ${r2(pct(next.show) + 0.01)}%, 100% { opacity: 0 } }`;
    }
  });

  css += `
    @media (prefers-reduced-motion: reduce) {
      .anim, .blink, .bar, .star, .glow-a, .glow-b { animation: none !important; }
      .cover { opacity: 0 !important; }
    }`;

  // --- typed command lines --------------------------------------------------
  const lines = steps
    .map((s, i) => {
      const w = r2(s.cmd.length * CH);
      const clipW = r2(w + 14);
      return `
    <g class="anim show${i}">
      <text class="mono" x="${X0}" y="${s.y}" fill="${C.green}">$</text>
      <text class="mono" x="${r2(XT)}" y="${s.y}" fill="${C.text}" textLength="${w}" lengthAdjust="spacing">${esc(s.cmd)}</text>
      <g clip-path="url(#clip${i})">
        <g class="cover anim type${i}">
          <rect x="${r2(XT)}" y="${s.y - 17}" width="${clipW}" height="26" fill="${C.bg}"/>
          <g class="anim cur${i}"><rect class="blink" x="${r2(XT + 1.5)}" y="${s.y - 15}" width="8.5" height="20" rx="1.5" fill="${C.purple}"/></g>
        </g>
      </g>
    </g>`;
    })
    .join('');

  const clips = steps
    .map((s, i) => `<clipPath id="clip${i}"><rect x="${r2(XT)}" y="${s.y - 17}" width="${r2(s.cmd.length * CH + 14)}" height="26"/></clipPath>`)
    .join('\n    ');

  // --- outputs ------------------------------------------------------------
  const status = config.status
    .map((p) => `<tspan fill="${p.c ? C[p.c] : C.muted}"${p.c ? ' font-weight="600"' : ''}>${esc(p.t)}</tspan>`)
    .join('');

  // --- equalizer ----------------------------------------------------------
  const pitch = 12;
  const count = Math.floor((W - 2 * X0 + 5) / pitch);
  const eqBottom = 314;
  let bars = '';
  for (let i = 0; i < count; i++) {
    // Smooth-ish envelope plus noise so it reads as a waveform, not static.
    const env = 0.55 + 0.45 * Math.sin((i / count) * Math.PI * 3 + 0.6);
    const h = r2(10 + (0.35 + 0.65 * rand()) * env * 38);
    const dur = r2(0.55 + rand() * 0.85);
    const delay = r2(-rand() * 2);
    bars += `<rect class="bar" x="${X0 + i * pitch}" y="${r2(eqBottom - h)}" width="7" height="${h}" rx="3.5" style="animation-duration:${dur}s;animation-delay:${delay}s"/>`;
  }

  // --- stars --------------------------------------------------------------
  let stars = '';
  for (let i = 0; i < 26; i++) {
    const x = r2(360 + rand() * 450);
    const y = r2(56 + rand() * 170);
    const r = r2(0.7 + rand() * 1.3);
    const col = [C.purple, C.pink, C.cyan, C.text][Math.floor(rand() * 4)];
    stars += `<circle class="star" cx="${x}" cy="${y}" r="${r}" fill="${col}" style="animation-duration:${r2(1.6 + rand() * 3)}s;animation-delay:${r2(-rand() * 4)}s"/>`;
  }

  const [s0, s1, s2] = steps;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(config.headline)} — ${esc(config.status.map((p) => p.t).join(''))}">
  <title>${esc(config.headline)}</title>
  <defs>
    <linearGradient id="border" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.purple}"/>
      <stop offset=".5" stop-color="${C.pink}"/>
      <stop offset="1" stop-color="${C.cyan}"/>
      <animateTransform attributeName="gradientTransform" type="rotate" from="0 .5 .5" to="360 .5 .5" dur="8s" repeatCount="indefinite"/>
    </linearGradient>
    <linearGradient id="shine" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="420" y2="0" spreadMethod="reflect">
      <stop offset="0" stop-color="${C.purple}"/>
      <stop offset=".5" stop-color="${C.pink}"/>
      <stop offset="1" stop-color="${C.cyan}"/>
      <animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="840 0" dur="7s" repeatCount="indefinite"/>
    </linearGradient>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="46"/></filter>
    <clipPath id="card"><rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="14"/></clipPath>
    ${clips}
  </defs>
  <style>${css}
  </style>

  <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="14" fill="${C.bg}"/>
  <g clip-path="url(#card)">
    <g filter="url(#blur)" opacity=".5">
      <circle class="glow-a" cx="700" cy="110" r="90" fill="${C.purple}"/>
      <circle class="glow-b" cx="520" cy="210" r="70" fill="${C.cyan}" opacity=".55"/>
      <circle class="glow-a" cx="800" cy="250" r="60" fill="${C.pink}" opacity=".6"/>
    </g>
    ${stars}
    <rect x="0" y="0" width="${W}" height="40" fill="${C.bar}"/>
    <rect x="0" y="40" width="${W}" height="1" fill="${C.line}"/>
    <circle cx="24" cy="20.5" r="6" fill="#ff5f57"/>
    <circle cx="44" cy="20.5" r="6" fill="#febc2e"/>
    <circle cx="64" cy="20.5" r="6" fill="#28c840"/>
    <text x="${W / 2}" y="25" text-anchor="middle" fill="${C.muted}" font-family="${MONO}" font-size="13">${esc(config.title)}</text>
  </g>

  <g class="anim all">${lines}
    <g class="anim out${s0.i}">
      <text x="${X0 - 2}" y="${s0.y + 50}" fill="url(#shine)" font-family="${SANS}" font-size="40" font-weight="800" letter-spacing="-.5">${esc(config.headline)}</text>
    </g>
    <g class="anim out${s1.i}">
      <text x="${X0}" y="${s1.y + 28}" font-family="${MONO}" font-size="15" xml:space="preserve">${status}</text>
    </g>
    <g class="anim out${s2.i}" fill="url(#shine)">${bars}</g>
  </g>

  <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="14" fill="none" stroke="url(#border)" stroke-width="2"/>
</svg>
`;
}

function footer() {
  const FH = 110;
  const wave = (lambda, amp, y) => {
    let d = `M${-lambda},${y} Q${-lambda + lambda / 4},${y - amp} ${-lambda + lambda / 2},${y}`;
    for (let x = -lambda / 2 + lambda / 2; x <= W + lambda; x += lambda / 2) d += ` T${r2(x)},${y}`;
    return `${d} V${FH} H${-lambda} Z`;
  };
  const layers = [
    { lambda: 420, amp: 26, y: 58, dur: 14, op: 0.28, dir: 1 },
    { lambda: 280, amp: 20, y: 70, dur: 9, op: 0.4, dir: -1 },
    { lambda: 210, amp: 14, y: 84, dur: 6, op: 0.75, dir: 1 },
  ];
  const css = layers
    .map(
      (l, i) => `
    .w${i} { animation: w${i} ${l.dur}s linear infinite; }
    @keyframes w${i} { from { transform: translateX(${l.dir > 0 ? 0 : l.lambda}px) } to { transform: translateX(${l.dir > 0 ? l.lambda : 0}px) } }`,
    )
    .join('');
  const paths = layers.map((l, i) => `<path class="w${i}" d="${wave(l.lambda, l.amp, l.y)}" fill="url(#g)" opacity="${l.op}"/>`).join('\n    ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${FH}" width="${W}" height="${FH}" preserveAspectRatio="none" role="img" aria-label="Animated wave">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.purple}"/>
      <stop offset=".5" stop-color="${C.pink}"/>
      <stop offset="1" stop-color="${C.cyan}"/>
    </linearGradient>
    <clipPath id="c"><rect width="${W}" height="${FH}" rx="14"/></clipPath>
  </defs>
  <style>${css}
    @media (prefers-reduced-motion: reduce) { path { animation: none !important; } }
  </style>
  <g clip-path="url(#c)">
    ${paths}
  </g>
</svg>
`;
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'header.svg'), header());
writeFileSync(join(out, 'footer.svg'), footer());
console.log('Wrote assets/header.svg and assets/footer.svg');
