import type {
  LottoAnalysis,
  LottoDraw,
  LottoFilter,
  LottoGame,
  LottoLag,
  LottoModelSignal,
  LottoState,
  LottoWeights,
} from "@workspace/api-zod";

const RAPIDAPI_PREFIX = "/lottery-results";
const RAPIDAPI_HOST = "usa-lottery-result-all-state-api.p.rapidapi.com";
const RAPIDAPI_BASE_URL = `https://${RAPIDAPI_HOST}/`;
const HISTORY_CACHE_TTL = 15 * 60 * 1000;
const METADATA_CACHE_TTL = 60 * 60 * 1000;

type Counter = Map<number, number>;
type WeightConfig = LottoWeights;

interface ApiEnvelope {
  status?: string;
  message?: string;
  data?: unknown;
}

interface RawState {
  state?: string;
  stateCode?: string;
}

interface RawGame {
  id?: number | string;
  gameName?: string;
  state?: RawState | RawState[];
  minBall?: number | string;
  maxBall?: number | string;
  drawnNumbers?: number | string;
}

interface RawDrawResult {
  drawID?: number | string;
  drawDate?: string;
  draw_date?: string;
  drawDateTime?: string;
  bonus?: number | string;
  winning_numbers?: string;
  winningNumbers?: number[] | string;
  additionalNumbers?: number[] | string[];
  date?: string;
}

interface LotteryRules {
  minBall: number;
  maxBall: number;
  picks: number;
}

interface CacheEntry {
  expiresAt: number;
  value: Promise<unknown>;
}

const cache = new Map<string, CacheEntry>();

const DEFAULT_WEIGHTS: WeightConfig = {
  markov: 2,
  hmm: 1.5,
  sum: 1,
  rf: 2,
  nn: 1.5,
  frequency: 0.5,
};

function cached<T>(
  key: string,
  ttl: number,
  load: () => Promise<T>,
): Promise<T> {
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) {
    return existing.value as Promise<T>;
  }

  const value = load();
  cache.set(key, { expiresAt: Date.now() + ttl, value });
  value.catch(() => cache.delete(key));
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function rapidApiJson(path: string): Promise<unknown> {
  const apiKey = process.env.RAPIDAPI_API_KEY;
  if (!apiKey) {
    throw new Error("RAPIDAPI_API_KEY Replit Secret is not configured");
  }

  const response = await fetch(new URL(path.replace(/^\/+/, ""), RAPIDAPI_BASE_URL), {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-rapidapi-host": RAPIDAPI_HOST,
      "x-rapidapi-key": apiKey,
    },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(
      `RapidAPI request failed (${response.status})${message ? `: ${message.slice(0, 240)}` : ""}`,
    );
  }
  const body = (await response.json()) as ApiEnvelope;
  if (body.status && body.status.toLowerCase() !== "success") {
    throw new Error(body.message || "Lottery provider returned an unsuccessful response");
  }
  return body.data;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export async function fetchLottoStates(): Promise<LottoState[]> {
  return cached("lotto:states", METADATA_CACHE_TTL, async () => {
    const data = await rapidApiJson(`${RAPIDAPI_PREFIX}/states`);
    const states = asList(data)
      .filter(isRecord)
      .map((item) => ({
        stateCode: String(item.stateCode ?? "").trim().toUpperCase(),
        stateName: String(item.state ?? "").trim(),
      }))
      .filter((state) => state.stateCode && state.stateName)
      .sort((a, b) => a.stateName.localeCompare(b.stateName));

    if (states.length === 0) {
      throw new Error("The lottery provider returned no supported states");
    }
    return states;
  });
}

export async function fetchLottoGames(stateCode: string): Promise<LottoGame[]> {
  const normalizedState = stateCode.trim().toUpperCase();
  return cached(`lotto:games:${normalizedState}`, METADATA_CACHE_TTL, async () => {
    const params = new URLSearchParams({ state: normalizedState });
    const data = await rapidApiJson(
      `${RAPIDAPI_PREFIX}/states/game-list?${params.toString()}`,
    );
    const games = asList(data)
      .filter(isRecord)
      .map((item) => {
        return {
          id: Number(item.id),
          gameName: String(item.gameName ?? "").trim(),
          // The provider can describe a game's origin state even when the
          // game is offered in the state used for this request.
          stateCode: normalizedState,
          minBall: Number(item.minBall ?? 1),
          maxBall: Number(item.maxBall),
          drawnNumbers: Number(item.drawnNumbers),
        };
      })
      .filter(
        (game) =>
          Number.isSafeInteger(game.id) &&
          game.id > 0 &&
          game.gameName &&
          Number.isFinite(game.minBall) &&
          Number.isFinite(game.maxBall) &&
          Number.isFinite(game.drawnNumbers),
      );

    return games.sort((a, b) => a.gameName.localeCompare(b.gameName));
  });
}

function parseWinningNumbers(
  value: unknown,
  rules: LotteryRules,
): number[] {
  const candidates = Array.isArray(value)
    ? value.map(Number)
    : String(value ?? "")
        .trim()
        .split(/\s+/)
        .filter((part) => /^\d+$/.test(part))
        .map(Number);
  return candidates.filter(
    (number) =>
      Number.isSafeInteger(number) &&
      number >= rules.minBall &&
      number <= rules.maxBall,
  );
}

function toDraw(row: RawDrawResult, rules: LotteryRules): LottoDraw | null {
  const numbers = parseWinningNumbers(
    row.winningNumbers ?? row.winning_numbers,
    rules,
  );
  const dateValue = row.drawDate ?? row.drawDateTime ?? row.draw_date ?? row.date;
  const date = dateValue ? new Date(dateValue) : null;
  if (
    !date ||
    Number.isNaN(date.getTime()) ||
    numbers.length !== rules.picks ||
    new Set(numbers).size !== numbers.length
  ) {
    return null;
  }

  const numericBonus = row.bonus ?? row.additionalNumbers?.[0] ?? null;
  const parsedBonus =
    numericBonus === null || numericBonus === ""
      ? null
      : Number(numericBonus);

  return {
    date: date.toISOString().slice(0, 10),
    numbers: numbers.sort((a, b) => a - b),
    bonus:
      parsedBonus !== null && Number.isFinite(parsedBonus)
        ? parsedBonus
        : null,
  };
}

async function fetchDrawDates(gameId: number): Promise<RawDrawResult[]> {
  const params = new URLSearchParams({ gameID: String(gameId) });
  const data = await rapidApiJson(
    `${RAPIDAPI_PREFIX}/old/past-draws-dates?${params.toString()}`,
  );
  if (Array.isArray(data)) {
    return data.filter(isRecord) as RawDrawResult[];
  }
  if (isRecord(data)) {
    const dates = Array.isArray(data.date) ? data.date : [];
    return dates.filter(isRecord) as RawDrawResult[];
  }
  return [];
}

async function fetchGameResult(
  gameId: number,
  drawId: number,
): Promise<unknown> {
  const params = new URLSearchParams({
    gameID: String(gameId),
    drawID: String(drawId),
  });
  return rapidApiJson(
    `${RAPIDAPI_PREFIX}/game-result?${params.toString()}`,
  );
}

export async function fetchLottoDraws(
  gameId: number,
  limit: number,
  rules: LotteryRules,
): Promise<LottoDraw[]> {
  return cached(
    `lotto:draws:${gameId}:${rules.maxBall}:${rules.picks}:${limit}`,
    HISTORY_CACHE_TTL,
    async () => {
      const dates = await fetchDrawDates(gameId);
      const ordered = [...dates].sort((a, b) => {
        const dateA = new Date(String(a.drawDate ?? "")).getTime();
        const dateB = new Date(String(b.drawDate ?? "")).getTime();
        return dateB - dateA;
      });
      const selected = ordered.slice(0, limit);

      const directResults = selected.filter(
        (entry) => entry.winningNumbers || entry.winning_numbers,
      );
      const results: unknown[] = [...directResults];
      const missingResults = selected.filter(
        (entry) => !entry.winningNumbers && !entry.winning_numbers,
      );

      for (let offset = 0; offset < missingResults.length; offset += 5) {
        const batch = missingResults.slice(offset, offset + 5);
        const batchResults = await Promise.all(
          batch.map(async (entry) => {
            const drawId = Number(entry.drawID);
            if (!Number.isSafeInteger(drawId) || drawId <= 0) return null;
            return fetchGameResult(gameId, drawId);
          }),
        );
        results.push(...batchResults.filter((result) => result !== null));
      }

      const draws = results
        .map((result) => {
          if (isRecord(result) && "data" in result) {
            const payload = result.data;
            return toDraw(
              (Array.isArray(payload) ? payload[0] : payload) as RawDrawResult,
              rules,
            );
          }
          return toDraw(result as RawDrawResult, rules);
        })
        .filter((draw): draw is LottoDraw => draw !== null)
        .sort((a, b) => a.date.localeCompare(b.date));

      if (draws.length < 5) {
        throw new Error(
          "The selected game returned fewer than five usable historical draws",
        );
      }
      return draws;
    },
  );
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

function drawFeatures(draw: number[], rules: LotteryRules): number[] {
  const sorted = [...draw].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((number, index) => number - sorted[index]);
  const meanGap =
    gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(gaps.length, 1);
  const variance =
    gaps.reduce((sum, gap) => sum + (gap - meanGap) ** 2, 0) /
    Math.max(gaps.length, 1);
  const range = Math.max(1, rules.maxBall - rules.minBall);
  return [
    sorted.reduce((sum, number) => sum + number, 0) /
      (rules.maxBall * rules.picks),
    meanGap / range,
    Math.sqrt(variance) / range,
    sorted.filter((number) => number % 2 === 1).length / rules.picks,
    sorted
      .filter((number) => number <= (rules.minBall + rules.maxBall) / 2)
      .length / rules.picks,
  ];
}

function featureDistance(left: number[], right: number[]): number {
  return Math.sqrt(
    left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0),
  );
}

function mlProxyScores(
  draws: number[][],
  rules: LotteryRules,
): { rf: Counter; nn: Counter } {
  const latest = draws.at(-1) ?? [];
  const latestFeatures = drawFeatures(latest, rules);
  const rf = new Map<number, number>();
  const nn = new Map<number, number>();

  for (let index = 0; index < draws.length - 1; index += 1) {
    const distance = featureDistance(
      latestFeatures,
      drawFeatures(draws[index], rules),
    );
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

function ticketFilters(numbers: number[], minBall: number): LottoFilter[] {
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
      passed: new Set(
        sorted.map((number) => Math.floor((number - minBall) / 10)),
      ).size > 1,
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

function proposeTicket(
  scores: Counter,
  seed: number,
  rules: LotteryRules,
): { ticket: number[]; score: number } {
  const random = seededRandom(seed);
  const ranked = topNumbers(scores, Math.max(30, rules.picks));
  const pool =
    ranked.length >= rules.picks
      ? ranked
      : Array.from(
          { length: rules.maxBall - rules.minBall + 1 },
          (_, index) => index + rules.minBall,
        );
  let best: number[] | null = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const candidate = new Set<number>();
    while (candidate.size < rules.picks) {
      const index = Math.min(
        pool.length - 1,
        Math.floor(-Math.log(Math.max(random(), 0.000001)) * 6),
      );
      candidate.add(pool[index]);
    }
    const ticket = [...candidate].sort((a, b) => a - b);
    const filters = ticketFilters(ticket, rules.minBall);
    if (!filters.every((filter) => filter.passed)) continue;
    const score = ticket.reduce((sum, number) => sum + (scores.get(number) ?? 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = ticket;
    }
  }

  if (!best) {
    best = ranked.slice(0, rules.picks).sort((a, b) => a - b);
    while (best.length < rules.picks) {
      const candidate =
        Math.floor(random() * (rules.maxBall - rules.minBall + 1)) +
        rules.minBall;
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
  stateCode: string,
  gameId: number,
): Promise<LottoAnalysis> {
  const states = await fetchLottoStates();
  const selectedState = states.find(
    (state) => state.stateCode === stateCode.toUpperCase(),
  );
  if (!selectedState) {
    throw new Error("The selected state is not supported by the lottery provider");
  }

  const games = await fetchLottoGames(selectedState.stateCode);
  const selectedGame = games.find((game) => game.id === gameId);
  if (!selectedGame) {
    throw new Error("The selected lottery game is not available in this state");
  }

  const rules = {
    minBall: selectedGame.minBall,
    maxBall: selectedGame.maxBall,
    picks: selectedGame.drawnNumbers,
  };
  if (
    rules.minBall < 1 ||
    rules.maxBall > 100 ||
    rules.maxBall <= rules.minBall ||
    rules.picks < 2 ||
    rules.picks > 12
  ) {
    throw new Error("The selected game uses unsupported number rules");
  }

  const draws = await fetchLottoDraws(gameId, limit, rules);
  const numberDraws = draws.map((draw) => draw.numbers);
  const latestDraw = draws.at(-1)!;
  const { scores: markov, top: transitions } = calculateTransitions(numberDraws);
  const hmm = hmmScores(numberDraws);
  const sum = sumTransitionScores(numberDraws);
  const frequency = frequencyScores(numberDraws);
  const ml = mlProxyScores(numberDraws, rules);
  const combined = weightedVote([
    [markov, DEFAULT_WEIGHTS.markov],
    [hmm, DEFAULT_WEIGHTS.hmm],
    [sum, DEFAULT_WEIGHTS.sum],
    [ml.rf, DEFAULT_WEIGHTS.rf],
    [ml.nn, DEFAULT_WEIGHTS.nn],
    [frequency, DEFAULT_WEIGHTS.frequency],
  ]);
  const proposal = proposeTicket(combined, seed, rules);

  return {
    source: "USA Lottery Result All State API · RapidAPI",
    stateCode: selectedState.stateCode,
    stateName: selectedState.stateName,
    gameId: selectedGame.id,
    gameName: selectedGame.gameName,
    maxBall: selectedGame.maxBall,
    mainNumberCount: selectedGame.drawnNumbers,
    generatedAt: new Date().toISOString(),
    drawsLoaded: draws.length,
    latestDraw,
    ticket: proposal.ticket,
    ticketScore: proposal.score,
    ticketFilters: ticketFilters(proposal.ticket, rules.minBall),
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
    frequency: topNumbers(
      frequency,
      rules.maxBall - rules.minBall + 1,
    ).map((number) => ({
      number,
      count: frequency.get(number) ?? 0,
    })),
    recentDraws: draws.slice(-12).reverse(),
    transitions,
    weights: DEFAULT_WEIGHTS,
  };
}