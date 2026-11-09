#!/usr/bin/env node
// Generates the README graphics in docs/assets. The console recording is drawn by the real live-view code from the
// event timeline of a real run (docs/assets/recording-data.json). Run with: npm run art
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFrame } from '../dist/cli/live.js';
import { OutputFormatter } from '../dist/cli/output.js';

const root = new URL('..', import.meta.url).pathname;
const out = (name, svg) => { writeFileSync(join(root, 'docs/assets', name), svg); console.log(`wrote docs/assets/${name} (${(svg.length / 1024).toFixed(0)} KB)`); };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Colours carry meaning: green = confirmed, amber = flagged, coral = removed.
const C = { bg: '#0a1020', bg2: '#0e1830', panel: '#111c33', line: '#1d2e4d', text: '#e8eef8', muted: '#8ea3bd', gray: '#5b6676', teal: '#35f2c0', cyan: '#36d6ff', amber: '#ffc94a', coral: '#ff5d73', violet: '#8b7bff' };
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace";

const glow = (id, std = 5) => `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${std}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
const grid = (id) => `<pattern id="${id}" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#16253f" stroke-width="1"/></pattern>`;

// ---------------------------------------------------------------- wordmark (neon sign)
function wordmark() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 300" width="1280" height="300" role="img" aria-label="Veritas">
<defs>${glow('g1', 7)}${glow('g2', 3)}${grid('grid')}
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0c1428"/><stop offset="1" stop-color="#070b16"/></linearGradient></defs>
<rect width="1280" height="300" rx="22" fill="url(#bg)"/><rect width="1280" height="300" rx="22" fill="url(#grid)" opacity=".6"/>
<g filter="url(#g1)"><rect x="70" y="40" width="1140" height="220" rx="46" fill="none" stroke="${C.teal}" stroke-width="5">
<animate attributeName="opacity" values="1;1;.35;1;.55;1;1;1" keyTimes="0;.62;.64;.66;.68;.7;.9;1" dur="7s" repeatCount="indefinite"/></rect></g>
<rect x="70" y="40" width="1140" height="220" rx="46" fill="none" stroke="#c9fff0" stroke-width="1.6" opacity=".9"/>
<g filter="url(#g2)"><text x="640" y="190" text-anchor="middle" font-family="${SANS}" font-weight="800" font-size="132" letter-spacing="18" fill="none" stroke="${C.amber}" stroke-width="5">VERITAS
<animate attributeName="opacity" values="1;1;.5;1;.8;1;1" keyTimes="0;.3;.31;.33;.35;.37;1" dur="9s" repeatCount="indefinite"/></text></g>
<text x="640" y="190" text-anchor="middle" font-family="${SANS}" font-weight="800" font-size="132" letter-spacing="18" fill="none" stroke="#fff6dc" stroke-width="1.6">VERITAS</text>
<g stroke="${C.teal}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none" filter="url(#g2)"><path d="M520 232 L560 246 L720 226" stroke-dasharray="260" stroke-dashoffset="260"><animate attributeName="stroke-dashoffset" values="260;0;0;260" keyTimes="0;.25;.85;1" dur="6s" repeatCount="indefinite"/><animate attributeName="stroke-opacity" values="0;1;1;0" keyTimes="0;.02;.85;1" dur="6s" repeatCount="indefinite"/></path></g>
</svg>`;
}

// ---------------------------------------------------------------- chapter banner
function banner() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 470" width="1280" height="470" role="img" aria-label="Veritas: every claim checked">
<defs>${glow('g', 6)}${grid('grid')}
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0d1730"/><stop offset="1" stop-color="#070b16"/></linearGradient>
<linearGradient id="side" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f1b36"/><stop offset="1" stop-color="#0a1226"/></linearGradient></defs>
<rect width="1280" height="470" rx="18" fill="url(#bg)" stroke="${C.line}"/><rect width="1280" height="470" rx="18" fill="url(#grid)" opacity=".5"/>
<polygon points="930,0 1280,0 1280,470 880,470" fill="url(#side)"/>
<path d="M56 46 H830 M56 46 V118" stroke="${C.teal}" stroke-width="3" fill="none" filter="url(#g)"/>
<path d="M56 46 H400" stroke="#d9fff5" stroke-width="2" fill="none"><animate attributeName="d" values="M56 46 H200;M56 46 H830;M56 46 H200" dur="8s" repeatCount="indefinite"/></path>
<text x="84" y="84" font-family="${SANS}" font-size="19" letter-spacing="7" fill="${C.teal}">VERITAS / THE AGENT THAT SHOWS ITS WORK</text>
<text x="80" y="198" font-family="${SANS}" font-weight="800" font-size="92" letter-spacing="-1" fill="${C.gray}">EVERY CLAIM.</text>
<text x="80" y="288" font-family="${SANS}" font-weight="800" font-size="92" letter-spacing="-1" fill="${C.teal}" filter="url(#g)">CHECKED.</text>
<text x="82" y="334" font-family="${SANS}" font-size="25" fill="${C.muted}">Give it a goal. Parallel agents do the work.</text>
<text x="82" y="366" font-family="${SANS}" font-size="25" fill="${C.muted}">An independent checker tests every claim against its source.</text>
<path d="M82 392 H830" stroke="${C.line}" stroke-width="2"/>
<g font-family="${SANS}" font-size="20" letter-spacing="4" fill="#7f97b3"><text x="82" y="434">01 / PLAN</text><text x="332" y="434">02 / WORK</text><text x="582" y="434">03 / VERIFY</text></g>
<g transform="translate(1085 225)">
<circle r="128" fill="#0b1630" stroke="${C.line}" stroke-width="2"/>
<g><circle r="150" fill="none" stroke="#2a4a78" stroke-width="2" stroke-dasharray="2 14" stroke-linecap="round"/><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="40s" repeatCount="indefinite"/></g>
<g filter="url(#g)"><circle r="108" fill="none" stroke="${C.cyan}" stroke-width="5" stroke-dasharray="120 560" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="6s" repeatCount="indefinite"/></circle>
<circle r="108" fill="none" stroke="${C.coral}" stroke-width="5" stroke-dasharray="40 640" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="180" to="540" dur="9s" repeatCount="indefinite"/></circle></g>
<path d="M0 -66 L58 -42 V8 C58 44 28 68 0 80 C-28 68 -58 44 -58 8 V-42 Z" fill="#0d2038" stroke="${C.teal}" stroke-width="5" stroke-linejoin="round" filter="url(#g)"/>
<path d="M-26 6 L-6 28 L30 -18" fill="none" stroke="#e9fff9" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="110" stroke-dashoffset="110"><animate attributeName="stroke-dashoffset" values="110;0;0;110" keyTimes="0;.3;.85;1" dur="5s" repeatCount="indefinite"/></path>
<text y="178" text-anchor="middle" font-family="${SANS}" font-size="17" letter-spacing="6" fill="#7f97b3">VERIFIED</text></g>
</svg>`;
}

// ---------------------------------------------------------------- capability cards
function card(x, y, title, lines, icon, accent, label) {
  return `<g transform="translate(${x} ${y})">
<rect width="604" height="250" rx="24" fill="#0c1426" stroke="${C.line}" stroke-width="2"/>
<rect x="6" y="6" width="592" height="238" rx="19" fill="none" stroke="${accent}" stroke-width="3" opacity=".9" filter="url(#g)"/>
<rect x="6" y="6" width="592" height="238" rx="19" fill="none" stroke="#ffffff" stroke-opacity=".25" stroke-width="1"/>
<rect x="6" y="6" width="150" height="238" rx="19" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="90 1000" opacity=".8"><animate attributeName="stroke-dashoffset" values="0;-1900" dur="9s" repeatCount="indefinite"/></rect>
<g transform="translate(96 100)"><circle r="62" fill="#101d36"/>${icon}</g>
<text x="190" y="72" font-family="${SANS}" font-size="15" letter-spacing="5" fill="${accent}">${label}</text>
<text x="190" y="116" font-family="${SANS}" font-weight="700" font-size="36" fill="${C.text}">${title}</text>
${lines.map((l, i) => `<text x="40" y="${186 + i * 30}" font-family="${SANS}" font-size="21" fill="#b4c3da">${l}</text>`).join('\n')}
</g>`;
}
function capabilities() {
  const stroke = (c) => `fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" filter="url(#g)"`;
  const verified = `<path d="M0 -38 L34 -24 V8 C34 28 16 40 0 47 C-16 40 -34 28 -34 8 V-24 Z" ${stroke(C.teal)}/><path d="M-15 4 L-3 17 L19 -10" ${stroke('#e9fff9')}/>`;
  const parallel = `<g ${stroke(C.cyan)}><circle cx="-32" cy="0" r="9"/><circle cx="30" cy="-26" r="9"/><circle cx="30" cy="0" r="9"/><circle cx="30" cy="26" r="9"/><path d="M-23 0 L21 -24 M-23 0 L21 0 M-23 0 L21 24"/></g>`;
  const files = `<g ${stroke(C.amber)}><path d="M-26 -34 H8 L22 -20 V34 H-26 Z"/><path d="M8 -34 V-20 H22"/><path d="M-16 -6 H12 M-16 8 H12 M-16 21 H2"/></g>`;
  const safe = `<g ${stroke(C.violet)}><rect x="-26" y="-6" width="52" height="40" rx="8"/><path d="M-14 -6 V-18 A14 14 0 0 1 14 -18 V-6"/><circle cx="0" cy="14" r="4"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 540" width="1280" height="540" role="img" aria-label="What Veritas does">
<defs>${glow('g', 3)}${grid('grid')}</defs><rect width="1280" height="540" rx="18" fill="${C.bg}"/><rect width="1280" height="540" rx="18" fill="url(#grid)" opacity=".45"/>
${card(24, 10, 'Verified claims', ['Every fact is tied to a source and an exact quote.', 'An independent checker reads it. What fails is removed.'], verified, C.teal, 'VERITAS / TRUST')}
${card(652, 10, 'Parallel agents', ['A planner splits the goal. Agents work at the same time.', 'You approve the plan and the cost first.'], parallel, C.cyan, 'VERITAS / SPEED')}
${card(24, 280, 'Your files and data', ['PDF, Word, Excel, CSV: cited to the exact page.', 'Numbers come only from code that really ran.'], files, C.amber, 'VERITAS / YOUR WORK')}
${card(652, 280, 'Safe by default', ['Code changes happen in a separate copy of your repo.', 'Commit, merge and push always ask you first.'], safe, C.violet, 'VERITAS / CONTROL')}
</svg>`;
}

// ---------------------------------------------------------------- flow diagram
function flow() {
  const box = (x, y, n, title, sub, c = C.cyan) => `<g transform="translate(${x} ${y})"><rect width="212" height="112" rx="18" fill="#101b33" stroke="${c}" stroke-width="3" filter="url(#g)"/><rect x="0" y="14" width="5" height="84" rx="2" fill="${C.coral}"/>
<text x="18" y="30" font-family="${SANS}" font-size="14" fill="${C.coral}">${n}</text>
<text x="106" y="66" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="25" fill="${C.text}">${title}</text>
<text x="106" y="92" text-anchor="middle" font-family="${SANS}" font-size="15" fill="${C.muted}">${sub}</text></g>`;
  const arrow = (x1, y, x2, c = '#2e6e8c') => `<path d="M${x1} ${y} H${x2 - 8}" stroke="${c}" stroke-width="3" fill="none"/><path d="M${x2 - 14} ${y - 8} L${x2 - 2} ${y} L${x2 - 14} ${y + 8}" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  const dot = (path, c, d) => `<circle r="5" fill="${c}"><animateMotion path="${path}" dur="${d}s" repeatCount="indefinite"/></circle>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 470" width="1280" height="470" role="img" aria-label="How a Veritas task flows">
<defs>${glow('g', 3)}${grid('grid')}</defs><rect width="1280" height="470" rx="18" fill="${C.bg}" stroke="${C.line}"/><rect width="1280" height="470" rx="18" fill="url(#grid)" opacity=".45"/>
<text x="40" y="58" font-family="${SANS}" font-weight="800" font-size="34" letter-spacing="1" fill="${C.text}">HOW A TASK FLOWS</text>
<text x="40" y="92" font-family="${SANS}" font-size="20" fill="#9fb2cc">From a goal to a cited result. Nothing reaches the report without passing the check.</text>
${box(40, 130, '01', 'Goal', 'you describe the work')}${arrow(252, 186, 292)}
${box(292, 130, '02', 'Plan', 'you approve it + cost')}${arrow(504, 186, 544)}
${box(544, 130, '03', 'Agents', 'work in parallel')}${arrow(756, 186, 796)}
${box(796, 130, '04', 'Check', 'each claim vs its source')}${arrow(1008, 186, 1048)}
${box(1048, 130, '05', 'Result', 'cited, with a summary')}
<path d="M902 242 V300 H770" stroke="${C.coral}" stroke-width="3" fill="none" stroke-dasharray="7 6"/><path d="M780 292 L768 300 L780 308" stroke="${C.coral}" stroke-width="3" fill="none" stroke-linecap="round"/>
<g transform="translate(556 262)"><rect width="212" height="84" rx="16" fill="#1b1220" stroke="${C.coral}" stroke-width="3"/><text x="106" y="38" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="22" fill="${C.text}">Removed</text><text x="106" y="64" text-anchor="middle" font-family="${SANS}" font-size="15" fill="${C.muted}">listed, with the reason</text></g>
<path d="M1000 242 V300 H1150" stroke="${C.amber}" stroke-width="3" fill="none" stroke-dasharray="7 6"/><path d="M1138 292 L1150 300 L1138 308" stroke="${C.amber}" stroke-width="3" fill="none" stroke-linecap="round"/>
<g transform="translate(1048 262)"><rect width="212" height="84" rx="16" fill="#1d1a10" stroke="${C.amber}" stroke-width="3"/><text x="106" y="38" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="22" fill="${C.text}">Flagged</text><text x="106" y="64" text-anchor="middle" font-family="${SANS}" font-size="15" fill="${C.muted}">shown with a warning</text></g>
<path d="M1154 262 V250" stroke="${C.amber}" stroke-width="3" fill="none"/><path d="M1146 256 L1154 244 L1162 256" stroke="${C.amber}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
${dot('M252 186 H292', C.cyan, 2)}${dot('M504 186 H544', C.cyan, 2.4)}${dot('M756 186 H796', C.cyan, 2.8)}${dot('M1008 186 H1048', C.teal, 3.2)}
<text x="40" y="440" font-family="${SANS}" font-size="16" fill="#7f97b3">Conceptual flow. No live metrics. Green = confirmed, amber = flagged, coral = removed.</text>
</svg>`;
}

// ---------------------------------------------------------------- console recording (drawn by the real live view)
const SGR = { 31: C.coral, 32: C.teal, 33: C.amber, 34: '#6aa8ff', 35: C.violet, 36: C.cyan, 90: '#6b7c93' };
function ansiToTspans(line) {
  const parts = [];
  let color = C.text, bold = false, dim = false, last = 0;
  const flush = (to) => { const t = line.slice(last, to); if (t) parts.push(`<tspan fill="${color}"${bold ? ' font-weight="700"' : ''}${dim ? ' fill-opacity=".6"' : ''}>${esc(t)}</tspan>`); };
  for (const m of line.matchAll(/\x1b\[([0-9;]*)m/g)) {
    flush(m.index);
    last = m.index + m[0].length;
    for (const code of m[1].split(';').map(Number)) {
      if (code === 0) { color = C.text; bold = false; dim = false; } else if (code === 1) bold = true; else if (code === 2) dim = true; else if (SGR[code]) color = SGR[code];
    }
  }
  flush(line.length);
  return parts.join('');
}

function console_() {
  const data = JSON.parse(readFileSync(join(root, 'docs/assets/recording-data.json'), 'utf8'));
  const fmt = new OutputFormatter({ color: true });
  const ev = data.events;
  const at = (type) => ev.find((e) => e.type === type)?.t ?? 0;
  const tPlan = at('plan.created'), tFinished = at('subtask.finished'), tVerifyDone = at('verify.done'), tDone = at('task.done');
  const sub = data.subtasks[0];
  const claimTimes = ev.filter((e) => e.type === 'claim.verified').map((e) => e.t);
  const nClaims = claimTimes.length;
  const afterTask = 0.0806826;                        // spent right after the task (recorded by the run)
  const afterPlan = afterTask - sub.cost_usd;         // what planning cost, derived from the two recorded numbers
  const base = { taskId: data.task.id, goal: data.task.goal, budgetUsd: data.task.budgetUsd, sources: { fetched: 0, failed: 0 }, tests: [] };
  const snap = (t) => {
    const status = t >= tDone ? 'done' : t >= tVerifyDone ? 'writing' : t >= tFinished ? 'verifying' : t >= at('task.running') ? 'running' : t >= tPlan ? 'planned' : 'draft';
    const spentUsd = t >= tDone ? data.task.spentUsd : t >= tFinished ? afterTask : t >= tPlan ? afterPlan : 0;
    const decided = claimTimes.filter((c) => c <= t).length;
    const claims = t >= at('evidence.ingested') && nClaims ? { confirmed: decided, flagged: 0, removed: 0, pending: nClaims - decided } : null;
    const subtasks = t >= tPlan ? [{ key: 't1', title: sub.title, status: t >= tFinished ? 'done' : t >= at('subtask.started') ? 'running' : 'pending', costUsd: t >= tFinished ? sub.cost_usd : 0, model: t >= at('subtask.started') ? sub.model : null, attempts: 1 }] : [];
    const last = t >= tDone ? 'done' : t >= tVerifyDone ? 'checked: all claims confirmed; writing the report' : t >= tFinished ? 'collecting sources and checking every claim' : t >= at('subtask.started') ? `> t1 ${sub.title} (${sub.model})` : t >= tPlan ? 'plan ready: 1 task' : 'planning...';
    return { ...base, status, spentUsd, claims, subtasks, last, sources: { fetched: t >= at('file.read') ? 1 : 0, failed: 0 } };
  };

  // Real seconds are compressed into a short loop; every real event and a steady spinner beat get a frame.
  const LOOP = 15, HOLD = 3.5, scale = (LOOP - HOLD) / tDone;
  const times = new Set([0]);
  for (const e of ev) times.add(e.t);
  for (let t = 0; t < tDone; t += 0.5 / scale) times.add(Math.round(t * 1000) / 1000);
  const stamps = [...times].sort((a, b) => a - b);
  const frames = stamps.map((t, i) => ({ start: t * scale, lines: buildFrame(snap(t), fmt, { width: 96, unicode: true, tick: i, elapsedMs: t * 1000 }) }));
  const final = [`Done. Spent $${data.task.spentUsd.toFixed(2)} of $${data.task.budgetUsd.toFixed(2)}.`, 'Result saved to ~/.veritas/tasks/' + data.task.id + '/result.md'];

  const LH = 21, X = 34, Y0 = 118, W = 960;
  const rows = Math.max(...frames.map((f) => f.lines.length)) + 3;
  const H = Y0 + rows * LH + 34;
  const total = LOOP;
  // Debug: ART_FRAME=n writes only frame n, still and fully visible, so the layout can be checked in a browser.
  const only = process.env.ART_FRAME === undefined ? -1 : Number(process.env.ART_FRAME);
  if (only >= 0) console.log(`frame ${only} of ${frames.length}`);
  const groups = frames.map((f, i) => {
    const end = i + 1 < frames.length ? frames[i + 1].start : total;
    const isLast = i === frames.length - 1;
    const kt = [0, f.start / total, end / total, 1].map((k) => Math.min(1, Math.max(0, +k.toFixed(5))));
    const vals = isLast ? '0;1;1;1' : '0;1;0;0';
    const body = f.lines.map((l, k) => `<text x="${X}" y="${Y0 + k * LH}" xml:space="preserve">${ansiToTspans(l)}</text>`).join('');
    const tail = isLast ? final.map((l, k) => `<text x="${X}" y="${Y0 + (f.lines.length + 1 + k) * LH}" xml:space="preserve"><tspan fill="${k === 0 ? C.teal : C.muted}">${esc(l)}</tspan></text>`).join('') : '';
    if (only >= 0) return i === only ? `<g>${body}${tail}</g>` : '';
    return `<g opacity="0"><animate attributeName="opacity" calcMode="discrete" keyTimes="${kt.join(';')}" values="${vals}" dur="${total}s" repeatCount="indefinite"/>${body}${tail}</g>`;
  });
  const cmd = 'veritas run "Which region\'s revenue grew fastest between 2023 and 2024…" --file sales.csv --budget 1.5';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="A Veritas run in the terminal: planning, one analysis task, eight claims checked and confirmed, a cited report">
<defs>${glow('g', 3)}</defs>
<rect width="${W}" height="${H}" rx="14" fill="#0b1122" stroke="${C.line}" stroke-width="2"/>
<rect width="${W}" height="44" rx="14" fill="#101a31"/><rect y="30" width="${W}" height="14" fill="#101a31"/>
<circle cx="26" cy="22" r="6.5" fill="${C.coral}"/><circle cx="48" cy="22" r="6.5" fill="${C.amber}"/><circle cx="70" cy="22" r="6.5" fill="${C.teal}"/>
<text x="${W / 2}" y="27" text-anchor="middle" font-family="${SANS}" font-size="14" letter-spacing="2" fill="#7f97b3">veritas — a real run, on a small sample file</text>
<g font-family="${MONO}" font-size="14.5">
<text x="${X}" y="76" xml:space="preserve"><tspan fill="${C.teal}">$</tspan><tspan fill="${C.text}"> ${esc(cmd)}</tspan></text>
${groups.join('\n')}
</g>
<text x="${W - 24}" y="${H - 14}" text-anchor="end" font-family="${SANS}" font-size="12" fill="#5d7088">Recorded from a real run (${esc(data.task.id)}). Waiting time is shortened; every number shown was recorded.</text>
</svg>`;
}

if (process.env.ART_FRAME !== undefined) { writeFileSync(process.env.ART_OUT ?? '/tmp/console-frame.svg', console_()); process.exit(0); }
out('wordmark.svg', wordmark());
out('banner.svg', banner());
out('capabilities.svg', capabilities());
out('flow.svg', flow());
out('console.svg', console_());
