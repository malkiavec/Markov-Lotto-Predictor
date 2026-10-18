import type {
  LottoAnalysis,
  LottoDraw,
  LottoFilter,
  LottoLag,
  LottoModelSignal,
  LottoWeights,
} from "@workspace/api-zod";

const SOCRATA_ENDPOINT = "https://data.ny.gov/resource/6nbc-h7bj.json";
const N_MAX = 59;
const PICKS = 6;
const SOURCE = "data.ny.gov · NY Lotto 6/59";

type Counter = Map<number, number>;
type WeightConfig = LottoWeights;

interface RawDraw {
  draw_date?: string;
  winning_numbers?: string;
  bonus?: string | number;
}

const DEFAULT_WEIGHTS: WeightConfig = {
  markov: 2,
  hmm: 1.5,
  sum: 1,
  rf: 2,
  nn: 1.5,
  frequency: 0.5,
};

function parseWinningNumbers(value: unknown): number[] {
  return String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter((part) => /^\d+$/.test(part))
    .map(Number)
    .filter((number) => number >= 1 && number <= N_MAX);
}

function toDraw(row: RawDraw): LottoDraw | null {
  const numbers = parseWinningNumbers(row.winning_numbers);
  const date = row.draw_date ? new Date(row.draw_date) : null;
  if (!date || Number.isNaN(date.getTime()) || numbers.length !== PICKS) {
    return null;
  }

  const numericBonus =
    row.bonus === undefined || row.bonus === null || row.bonus === ""
      ? null
      : Number(row.bonus);

  return {
    date: date.toISOString().slice(0, 10),
    numbers: [...new Set(numbers)].sort((a, b) => a - b),
    bonus:
      numericBonus !== null && Number.isFinite(numericBonus)
        ? numericBonus
        : null,
  };
}

export async function fetchLottoDraws(limit: number): Promise<LottoDraw[]> {
  const url = new URL(SOCRATA_ENDPOINT);
  url.searchParams.set("$limit", String(limit));
  url.searchParams.set("$order", "draw_date ASC");

  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`NY data source returned ${response.status}`);
  }

  const rows = (await response.json()) as RawDraw[];
  const draws = rows
    .map(toDraw)
    .filter((draw): draw is LottoDraw => draw !== null)
    .filter((draw) => draw.numbers.length === PICKS);

  if (draws.length < 50) {
    throw new Error("NY data source returned too few valid draws");
  }
  return draws;
}

function addScore(counter: Counter, number: number, score: number): void {
  counter.set(number, (counter.get(number) ?? 0) + score);
}

function topNumbers(counter: Counter, count: number): number[] {
  return [...counter.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, count)
    .map(([number]) => number);
}

function calculateTransitions(draws: number[][]): {
  scores: Counter;
  top: LottoAnalysis["transitions"];
} {
  const counts = new Map<number, Counter>();
  const stream = draws.flat();

  for (let index = 0; index < stream.length - 1; index += 1) {
    const from = stream[index];
    const to = stream[index + 1];
    const bucket = counts.get(from) ?? new Map<number, number>();
    addScore(bucket, to, 1);
    counts.set(from, bucket);
  }

  const scores = new Map<number, number>();
  for (const from of draws.at(-1) ?? []) {
    const bucket = counts.get(from);
    if (!bucket) continue;
    const total = [...bucket.values()].reduce((sum, value) => sum + value, 0);
    for (const [to, count] of bucket) {
      addScore(scores, to, count / total);
    }
  }

  const top = [...counts.entries()]
    .flatMap(([from, bucket]) => {
      const total = [...bucket.values()].reduce((sum, value) => sum + value, 0);
      return [...bucket.entries()].map(([to, count]) => ({
        from,
        to,
        probability: count / total,
      }));
    })
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 80);

  return { scores, top };
}

function drawSums(draws: number[][]): number[] {
  return draws.map((draw) => draw.reduce((sum, number) => sum + number, 0));
}

function correlation(left: number[], right: number[]): number {
  if (left.length < 3 || right.length !== left.length) return 0;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }

  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator === 0 ? 0 : numerator / denominator;
}

function discoverKeyLags(sums: number[]): LottoLag[] {
  const maxLag = Math.min(30, Math.max(5, Math.floor(sums.length / 4)));
  const lags: LottoLag[] = [];
  for (let lag = 1; lag <= maxLag; lag += 1) {
    const current = sums.slice(0, -lag);
    const delayed = sums.slice(lag);
    const corr = correlation(current, delayed);
    lags.push({
      lag,
      absoluteCorrelation: Math.abs(corr),
      correlation: corr,
    });
  }
  return lags
    .sort((a, b) => b.absoluteCorrelation - a.absoluteCorrelation)
    .slice(0, 5);
}

function sumTransitionScores(draws: number[][]): Counter {
  const sums = drawSums(draws);
  const deltaCounts = new Map<number, number>();
  for (let index = 1; index < sums.length; index += 1) {
    const delta = Math.round(sums[index] - sums[index - 1]);
    deltaCounts.set(delta, (deltaCounts.get(delta) ?? 0) + 1);
  }

  const lastSum = Math.round(sums.at(-1) ?? 0);
  const candidateSums = [...deltaCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([delta]) => lastSum + delta);
  const scores = new Map<number, number>();

  for (const targetSum of candidateSums) {
    for (let index = 0; index < sums.length; index += 1) {
      if (Math.abs(Math.round(sums[index]) - targetSum) > 3) continue;
      for (const number of draws[index]) addScore(scores, number, 1);
    }
  }
  return new Map([...scores.entries()].sort(([, a], [, b]) => b - a).slice(0, 25));
}

function quantileEdges(values: number[], binCount: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const edges: number[] = [];
  for (let index = 0; index <= binCount; index += 1) {
    const position = Math.min(
      sorted.length - 1,
      Math.floor((index / binCount) * (sorted.length - 1)),
    );
    const value = sorted[position];
    if (edges.at(-1) !== value) edges.push(value);
  }
  return edges.length > 2 ? edges : [Math.min(...values), Math.max(...values)];
}

function sumBin(sum: number, edges: number[]): number {
  let index = 0;
  for (let edge = 1; edge < edges.length; edge += 1) {
    if (sum >= edges[edge]) index = edge;
  }
  return Math.min(index, Math.max(0, edges.length - 2));
}

function hmmScores(draws: number[][]): Counter {
  const sums = drawSums(draws);
  const edges = quantileEdges(sums, 12);
  const bins = sums.map((sum) => sumBin(sum, edges));
  const transitions = new Map<number, Counter>();

  for (let index = 0; index < bins.length - 1; index += 1) {
    const bucket = transitions.get(bins[index]) ?? new Map<number, number>();
    addScore(bucket, bins[index + 1], 1);
    transitions.set(bins[index], bucket);
  }

  const lastBin = bins.at(-1) ?? 0;
  const nextBin = topNumbers(transitions.get(lastBin) ?? new Map(), 1)[0] ?? lastBin;
  const scores = new Map<number, number>();
  for (let index = 0; index < draws.length; index += 1) {
    if (bins[index] !== nextBin) continue;
    for (const number of draws[index]) addScore(scores, number, 1);
  }
  return new Map([...scores.entries()].sort(([, a], [, b]) => b - a).slice(0, 25));
}

function frequencyScores(draws: number[][]): Counter {
  const scores = new Map<number, number>();
  for (const draw of draws) {
    for (const number of draw) addScore(scores, number, 1);
  }
  return scores;
}

function drawFeatures(draw: number[]): number[] {
  const sorted = [...draw].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((number, index) => number - sorted[index]);
  const meanGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const variance =
    gaps.reduce((sum, gap) => sum + (gap - meanGap) ** 2, 0) / gaps.length;
  return [
    sorted.reduce((sum, number) => sum + number, 0) / (N_MAX * PICKS),
    meanGap / N_MAX,
    Math.sqrt(variance) / N_MAX,
    sorted.filter((number) => number % 2 === 1).length / PICKS,
    sorted.filter((number) => number <= 29).length / PICKS,
  ];
}

function featureDistance(left: number[], right: number[]): number {
  return Math.sqrt(
    left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0),
  );
}

function mlProxyScores(draws: number[][]): { rf: Counter; nn: Counter } {
  const latest = draws.at(-1) ?? [];
  const latestFeatures = drawFeatures(latest);
  const rf = new Map<number, number>();
  const nn = new Map<number, number>();

  for (let index = 0; index < draws.length - 1; index += 1) {
    const distance = featureDistance(latestFeatures, drawFeatures(draws[index]));
    const similarity = 1 / (0.08 + distance);
    for (const number of draws[index + 1]) addScore(rf, number, similarity);
  }

  const recentStart = Math.max(0, draws.length - 160);
  for (let index = recentStart; index < draws.length; index += 1) {
    const recency = (index - recentStart + 1) / (draws.length - recentStart);
    for (const number of draws[index]) addScore(nn, number, recency);
  }

  return { rf, nn };
}

function maxConsecutiveRun(numbers: number[]): number {
  const sorted = [...numbers].sort((a, b) => a - b);
  let best = sorted.length ? 1 : 0;
  let current = best;
  for (let index = 1; index < sorted.length; index += 1) {
    current = sorted[index] === sorted[index - 1] + 1 ? current + 1 : 1;
    best = Math.max(best, current);
  }
  return best;
}

function digitCount(numbers: number[], getDigit: (number: number) => number): number {
  const counts = new Map<number, number>();
  for (const number of numbers) {
    const digit = getDigit(number);
    counts.set(digit, (counts.get(digit) ?? 0) + 1);
  }
  return Math.max(...counts.values(), 0);
}

function ticketFilters(numbers: number[]): LottoFilter[] {
  const sorted = [...numbers].sort((a, b) => a - b);
  const run = maxConsecutiveRun(sorted);
  return [
    {
      name: "No five-run",
      description: "Rejects tickets containing five or more consecutive numbers.",
      passed: run < 5,
    },
    {
      name: "Spread across decades",
      description: "Rejects tickets that stay inside one decade bucket.",
      passed: new Set(sorted.map((number) => Math.floor((number - 1) / 10))).size > 1,
    },
    {
      name: "Wider than ten",
      description: "Rejects tickets fitting inside a ten-number window.",
      passed: sorted.at(-1)! - sorted[0] > 9,
    },
    {
      name: "No four-run",
      description: "Rejects tickets containing four or more consecutive numbers.",
      passed: run < 4,
    },
    {
      name: "Gap avoids 7–9",
      description: "Rejects tickets whose first-to-last gap is exactly 7, 8, or 9.",
      passed: !new Set([7, 8, 9]).has(sorted.at(-1)! - sorted[0]),
    },
    {
      name: "Last digits diversify",
      description: "Rejects tickets with five or more matching last digits.",
      passed: digitCount(sorted, (number) => number % 10) < 5,
    },
    {
      name: "First digits diversify",
      description: "Rejects tickets with five or more matching first digits.",
      passed: digitCount(sorted, (number) => Number(String(number)[0])) < 5,
    },
  ];
}

function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 42;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function weightedVote(
  counters: Array<[Counter, number]>,
): Counter {
  const combined = new Map<number, number>();
  for (const [counter, weight] of counters) {
    const max = Math.max(...counter.values(), 1);
    for (const [number, value] of counter) {
      addScore(combined, number, (value / max) * weight);
    }
  }
  return combined;
}

function proposeTicket(scores: Counter, seed: number): { ticket: number[]; score: number } {
  const random = seededRandom(seed);
  const ranked = topNumbers(scores, 30);
  const pool = ranked.length >= PICKS ? ranked : Array.from({ length: N_MAX }, (_, index) => index + 1);
  let best: number[] | null = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const candidate = new Set<number>();
    while (candidate.size < PICKS) {
      const index = Math.min(
        pool.length - 1,
        Math.floor(-Math.log(Math.max(random(), 0.000001)) * 6),
      );
      candidate.add(pool[index]);
    }
    const ticket = [...candidate].sort((a, b) => a - b);
    const filters = ticketFilters(ticket);
    if (!filters.every((filter) => filter.passed)) continue;
    const score = ticket.reduce((sum, number) => sum + (scores.get(number) ?? 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = ticket;
    }
  }

  if (!best) {
    best = ranked.slice(0, PICKS).sort((a, b) => a - b);
    while (best.length < PICKS) {
      const candidate = Math.floor(random() * N_MAX) + 1;
      if (!best.includes(candidate)) best.push(candidate);
    }
    best.sort((a, b) => a - b);
    bestScore = best.reduce((sum, number) => sum + (scores.get(number) ?? 0), 0);
  }

  return { ticket: best, score: Number(bestScore.toFixed(4)) };
}

function signal(
  name: string,
  description: string,
  counter: Counter,
  weight: number,
): LottoModelSignal {
  return { name, description, numbers: topNumbers(counter, 12), weight };
}

export async function createLottoAnalysis(
  limit: number,
  seed: number,
): Promise<LottoAnalysis> {
  const draws = await fetchLottoDraws(limit);
  const numberDraws = draws.map((draw) => draw.numbers);
  const latestDraw = draws.at(-1)!;
  const { scores: markov, top: transitions } = calculateTransitions(numberDraws);
  const hmm = hmmScores(numberDraws);
  const sum = sumTransitionScores(numberDraws);
  const frequency = frequencyScores(numberDraws);
  const ml = mlProxyScores(numberDraws);
  const combined = weightedVote([
    [markov, DEFAULT_WEIGHTS.markov],
    [hmm, DEFAULT_WEIGHTS.hmm],
    [sum, DEFAULT_WEIGHTS.sum],
    [ml.rf, DEFAULT_WEIGHTS.rf],
    [ml.nn, DEFAULT_WEIGHTS.nn],
    [frequency, DEFAULT_WEIGHTS.frequency],
  ]);
  const proposal = proposeTicket(combined, seed);

  return {
    source: SOURCE,
    generatedAt: new Date().toISOString(),
    drawsLoaded: draws.length,
    latestDraw,
    ticket: proposal.ticket,
    ticketScore: proposal.score,
    ticketFilters: ticketFilters(proposal.ticket),
    signals: [
      signal(
        "Markov transitions",
        "Next-number probabilities aggregated from the latest draw's flattened stream transitions.",
        markov,
        DEFAULT_WEIGHTS.markov,
      ),
      signal(
        "HMM / Viterbi",
        "Sum-bin state transitions identify the next likely hidden sum regime.",
        hmm,
        DEFAULT_WEIGHTS.hmm,
      ),
      signal(
        "Sum transitions",
        "Common historical sum deltas condition number frequency around candidate sums.",
        sum,
        DEFAULT_WEIGHTS.sum,
      ),
      signal(
        "RF-style features",
        "Similarity-weighted next-draw features provide a lightweight regression proxy.",
        ml.rf,
        DEFAULT_WEIGHTS.rf,
      ),
      signal(
        "NN-style recency",
        "Recency-weighted feature voting adds a short-memory neural-style signal.",
        ml.nn,
        DEFAULT_WEIGHTS.nn,
      ),
      signal(
        "Historical frequency",
        "Baseline count across every valid draw in the selected history window.",
        frequency,
        DEFAULT_WEIGHTS.frequency,
      ),
    ],
    lags: discoverKeyLags(drawSums(numberDraws)),
    frequency: topNumbers(frequency, N_MAX).map((number) => ({
      number,
      count: frequency.get(number) ?? 0,
    })),
    recentDraws: draws.slice(-12).reverse(),
    transitions,
    weights: DEFAULT_WEIGHTS,
  };
}