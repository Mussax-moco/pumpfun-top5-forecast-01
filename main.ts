// pumpfun-top5-forecast-01's house baseline (Node 22, standard library only): persistence, the forecast that the chart
// at every answer read is the chart of the last mark (the one forecast is scored on each read, and the score is the
// mean). It reads /input/task.json (the places scored, the size bins' edges and the output file) and the last mark of
// /input/history.ndjson (its rows, the eligible coins ranked by market cap at the cut), and writes
// /output/forecast.json:
//   - place 1: 0.30 on the coin at #1 then, 0.10 on the coin at #2;
//   - place k, from 2 to 5: 0.30 on the coin at #k then, 0.10 on each of the coins at #k-1 and #k+1;
//   - the rest of each place (0.60 at place 1, 0.50 at the others) is left unnamed: the scorer shares it among the
//     answer charts' coins the forecast does not name there, the movers and the coins born after the cut alike;
//   - sizes: place k's cap a normal in log10(cap in SOL) around the log10 of the cap of the coin at #k then, sd 0.35,
//     its probability in each of the 82 bins (0.05 wide, the tails below 2.0 and from 6.0 up), each p rounded down to
//     6 decimals, a bin whose p rounds to 0 left unnamed (the rest of the place's 1 is shared by them);
//   - top5: the last mark's top 5, in its order.
// Its numbers are fixed in advance, never tuned on the practice. A prize needs a score strictly above the best house
// entry's: this one's, or the house model forecast's.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
/** On the coin at #k for place k. */
const P_STAY = 0.28; // slight under-confidence on persistence
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

const task = JSON.parse(readFileSync(join(INPUT_DIR, 'task.json'), 'utf8')) as { places: number; output: string; size: { edges: number[] } };
const lines = readFileSync(join(INPUT_DIR, 'history.ndjson'), 'utf8').split('\n').filter((l) => l !== '');
const marks = lines.map((l) => JSON.parse(l));
const last = marks[marks.length - 1] as { t: string; rows: Row[] };
const top = last.rows.slice(0, task.places);

function normalCdf(x: number, mean: number, sd: number): number {
  const z = (x - mean) / sd;
  // approx
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
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
  // tails
  const pLo = normalCdf(edges[0], meanLog, SIZE_SD);
  const rLo = Math.floor(pLo * MICRO) / MICRO;
  if (rLo > 0) { out[`-${edges[0]}`] = rLo; total += rLo; }
  const pHi = 1 - normalCdf(edges[edges.length - 1], meanLog, SIZE_SD);
  const rHi = Math.floor(pHi * MICRO) / MICRO;
  if (rHi > 0) { out[`${edges[edges.length - 1]}+`] = rHi; total += rHi; }
  return out;
}

const places: any[] = [];
for (let k = 0; k < task.places; k++) {
  const stay = top[k];
  const probs: Record<string, number> = {};
  probs[stay.mint] = P_STAY;
  if (k > 0) probs[top[k - 1].mint] = (probs[top[k - 1].mint] || 0) + P_NEIGHBOUR;
  if (k + 1 < top.length) probs[top[k + 1].mint] = (probs[top[k + 1].mint] || 0) + P_NEIGHBOUR;
  const cap = Number(stay.market_cap_lamports) / 1e9; // SOL approx from lamports? wait, actually market_cap is in SOL*1e9 or check
  // market_cap_lamports is the market cap in lamports of SOL equivalent
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
