// pumpfun-top5-forecast-01 house-baseline style persistence with mild under-confidence.
// Reads last mark of /input/history.ndjson + task.json, writes /output/forecast.json.
// Node 22, standard library only.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
/** On the coin at #k for place k. */
const P_STAY = 0.28;
/** On each of the coins at #k-1 and #k+1 for place k. */
const P_NEIGHBOUR = 0.1;
/** The sd of a place's log10(cap in SOL) around the cap at #k then. */
const SIZE_SD = 0.35;
const MICRO = 1_000_000;

interface Row {
  rank: number;
  mint: string;
  market_cap_lamports: string | number;
}

const task = JSON.parse(readFileSync(join(INPUT_DIR, 'task.json'), 'utf8')) as {
  places: number;
  output: string;
  size: { edges: number[] };
};
const lines = readFileSync(join(INPUT_DIR, 'history.ndjson'), 'utf8')
  .split('\n')
  .filter((l) => l !== '');
const marks = lines.map((l) => JSON.parse(l));
const last = marks[marks.length - 1] as { t: string; rows: Row[] };
const top = last.rows.slice(0, task.places);

function normalCdf(x: number, mean: number, sd: number): number {
  const z = (x - mean) / sd;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

function sizeProbs(meanLog: number, edges: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  let total = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const p = normalCdf(hi, meanLog, SIZE_SD) - normalCdf(lo, meanLog, SIZE_SD);
    const r = Math.floor(p * MICRO) / MICRO;
    if (r > 0) {
      out[`${lo}-${hi}`] = r;
      total += r;
    }
  }
  const pLo = normalCdf(edges[0], meanLog, SIZE_SD);
  const rLo = Math.floor(pLo * MICRO) / MICRO;
  if (rLo > 0) {
    out[`-${edges[0]}`] = rLo;
    total += rLo;
  }
  const pHi = 1 - normalCdf(edges[edges.length - 1], meanLog, SIZE_SD);
  const rHi = Math.floor(pHi * MICRO) / MICRO;
  if (rHi > 0) {
    out[`${edges[edges.length - 1]}+`] = rHi;
    total += rHi;
  }
  return out;
}

const places: any[] = [];
for (let k = 0; k < task.places; k++) {
  const stay = top[k];
  const probs: Record<string, number> = {};
  probs[stay.mint] = P_STAY;
  if (k > 0) {
    const prev = top[k - 1].mint;
    probs[prev] = (probs[prev] || 0) + P_NEIGHBOUR;
  }
  if (k + 1 < top.length) {
    const next = top[k + 1].mint;
    probs[next] = (probs[next] || 0) + P_NEIGHBOUR;
  }
  // market_cap_lamports is SOL-equivalent market cap in lamports (1 SOL = 1e9)
  const meanLog = Math.log10(Math.max(Number(stay.market_cap_lamports) / 1e9, 1e-6));
  places.push({
    place: k + 1,
    probs,
    sizes: sizeProbs(meanLog, task.size.edges),
  });
}

const forecast = {
  top5: top.map((r) => r.mint),
  places,
};

writeFileSync(join(OUTPUT_DIR, task.output), JSON.stringify(forecast, null, 2));
console.log('wrote', task.output);
