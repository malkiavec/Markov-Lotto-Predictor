import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleX,
  Database,
  Dices,
  FlaskConical,
  Gauge,
  History,
  Info,
  Layers3,
  LineChart,
  Menu,
  RefreshCw,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  X,
} from 'lucide-react';
import { useGetLottoAnalysis, useGetLottoGames, useGetLottoStates, useHealthCheck, getGetLottoAnalysisQueryKey, getGetLottoGamesQueryKey, getGetLottoStatesQueryKey, getHealthCheckQueryKey } from '@workspace/api-client-react';
import type { LottoAnalysis, LottoDraw, LottoFilter, LottoGame, LottoLag, LottoModelSignal, LottoState } from '@workspace/api-client-react';

const numberFormat = new Intl.NumberFormat('en-US');
type IconComponent = (props: { className?: string }) => ReactNode;

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value));
}

function NumberBall({ value, tone = 'light', small = false }: { value: number; tone?: 'light' | 'dark' | 'accent'; small?: boolean }) {
  return (
    <span
      data-testid={`number-ball-${value}`}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-mono font-medium tabular-nums ${
        small ? 'h-7 w-7 text-[11px]' : 'h-11 w-11 text-sm'
      } ${
        tone === 'dark'
          ? 'border border-white/15 bg-white/10 text-[#f6eddc]'
          : tone === 'accent'
            ? 'bg-[#e36b4f] text-[#fff8ec] shadow-[0_4px_10px_rgba(187,72,48,.22)]'
            : 'border border-[#d9cfc0] bg-[#fdf9f0] text-[#29333a] shadow-[0_2px_4px_rgba(40,45,45,.07)]'
      }`}
    >
      {String(value).padStart(2, '0')}
    </span>
  );
}

function SectionTitle({ eyebrow, title, icon: Icon, action }: { eyebrow: string; title: string; icon: IconComponent; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <div className="mb-1 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[.17em] text-primary">
          <Icon className="h-3.5 w-3.5" />
          {eyebrow}
        </div>
        <h2 className="font-[var(--app-font-serif)] text-xl font-semibold tracking-[-.035em] text-foreground">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function Panel({ children, className = '', testId, id }: { children: ReactNode; className?: string; testId?: string; id?: string }) {
  return (
    <section id={id} data-testid={testId} className={`rounded-2xl border border-card-border bg-card shadow-[var(--shadow-sm)] ${className}`}>
      {children}
    </section>
  );
}

function Metric({ label, value, detail, accent = false }: { label: string; value: string; detail?: string; accent?: boolean }) {
  return (
    <div data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`} className="min-w-0">
      <p className="font-mono text-[9px] uppercase tracking-[.15em] text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate font-[var(--app-font-serif)] text-lg font-semibold tracking-[-.035em] ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</p>
      {detail && <p className="mt-0.5 text-[10px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

function SignalRow({ signal, index }: { signal: LottoModelSignal; index: number }) {
  return (
    <div data-testid={`signal-row-${index}`} className="group flex gap-3 border-b border-border/70 py-3 last:border-0">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
        {index === 0 ? <BrainCircuit className="h-3.5 w-3.5" /> : index === 1 ? <LineChart className="h-3.5 w-3.5" /> : <Target className="h-3.5 w-3.5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-foreground">{signal.name}</p>
          <span className="font-mono text-[10px] text-primary">{signal.weight.toFixed(2)}×</span>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{signal.description}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {signal.numbers.map((number) => <NumberBall key={number} value={number} small />)}
        </div>
      </div>
    </div>
  );
}

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-secondary/80 ${className}`} />;
}

function LoadingWorkspace() {
  return (
    <div className="space-y-6 p-5 md:p-8">
      <div className="space-y-3"><SkeletonBlock className="h-3 w-24" /><SkeletonBlock className="h-11 w-2/3" /><SkeletonBlock className="h-4 w-1/2" /></div>
      <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]"><SkeletonBlock className="h-64" /><SkeletonBlock className="h-64" /></div>
      <div className="grid gap-5 lg:grid-cols-2"><SkeletonBlock className="h-72" /><SkeletonBlock className="h-72" /></div>
    </div>
  );
}

function ErrorWorkspace({ onRetry, message }: { onRetry: () => void; message: string }) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-[#e8b5a7] bg-[#fff7ef] p-8 text-center shadow-[var(--shadow-sm)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#f6dfd6] text-primary"><CircleAlert className="h-6 w-6" /></div>
        <p className="mt-5 font-mono text-[10px] uppercase tracking-[.2em] text-primary">Analysis unavailable</p>
        <h2 className="mt-2 font-[var(--app-font-serif)] text-2xl font-semibold tracking-[-.04em] text-[#29333a]">The lab needs another pass.</h2>
        <p className="mt-2 text-sm leading-6 text-[#6e6258]">{message || 'We could not load the ensemble output right now. The public draw source may be taking a moment.'}</p>
        <button data-testid="button-retry-analysis" onClick={onRetry} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground transition-transform hover:-translate-y-0.5">
          <RefreshCw className="h-3.5 w-3.5" /> Retry analysis
        </button>
      </div>
    </div>
  );
}

function Sidebar({ mobileOpen, onClose, state, game }: { mobileOpen: boolean; onClose: () => void; state: string; game?: LottoGame }) {
  return (
    <>
      {mobileOpen && <button data-testid="button-close-mobile-nav" aria-label="Close navigation" onClick={onClose} className="fixed inset-0 z-30 bg-[#17232a]/35 lg:hidden"><X className="sr-only" /></button>}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[250px] flex-col bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform duration-300 lg:static lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
              <Dices className="h-4 w-4" />
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#eec46f]" />
            </div>
            <div><p className="font-[var(--app-font-serif)] text-sm font-bold tracking-[-.02em]">Northstar Lab</p><p className="max-w-[150px] truncate font-mono text-[8px] uppercase tracking-[.14em] text-sidebar-foreground/45">{state} · {game ? `${game.drawnNumbers} / ${game.maxBall}` : 'Lottery'}</p></div>
          </div>
          <button data-testid="button-close-nav" aria-label="Close navigation" onClick={onClose} className="rounded-lg p-1 text-sidebar-foreground/50 hover:bg-sidebar-accent lg:hidden"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-10 px-2 font-mono text-[9px] uppercase tracking-[.18em] text-sidebar-foreground/35">Workspace</div>
        <nav className="mt-2 space-y-1">
          <button data-testid="button-nav-analysis" className="flex w-full items-center gap-3 rounded-xl bg-sidebar-accent px-3 py-2.5 text-left text-xs font-semibold text-sidebar-accent-foreground"><Activity className="h-4 w-4 text-sidebar-primary" /> Live analysis <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary" /></button>
          <button data-testid="button-nav-history" onClick={() => document.getElementById('history')?.scrollIntoView({ behavior: 'smooth' })} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"><History className="h-4 w-4" /> Draw history</button>
          <button data-testid="button-nav-signals" onClick={() => document.getElementById('signals')?.scrollIntoView({ behavior: 'smooth' })} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"><Layers3 className="h-4 w-4" /> Model signals</button>
        </nav>
        <div className="mt-8 px-2 font-mono text-[9px] uppercase tracking-[.18em] text-sidebar-foreground/35">Reference</div>
        <nav className="mt-2 space-y-1">
          <button data-testid="button-nav-method" onClick={() => document.getElementById('method')?.scrollIntoView({ behavior: 'smooth' })} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"><FlaskConical className="h-4 w-4" /> Method notes</button>
          <button data-testid="button-nav-health" onClick={() => document.getElementById('health')?.scrollIntoView({ behavior: 'smooth' })} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"><Gauge className="h-4 w-4" /> System status</button>
        </nav>
        <div className="mt-auto rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold"><span className="h-2 w-2 rounded-full bg-[#78b89a]" /> Model online</div>
          <p className="mt-2 text-[10px] leading-4 text-sidebar-foreground/45">A transparent instrument for a game of chance. No promises, only signals.</p>
        </div>
        <div className="mt-4 flex items-center gap-2 px-2 text-[10px] text-sidebar-foreground/35"><span className="font-mono">v0.8.4</span><span>·</span><span>Ensemble core</span></div>
      </aside>
    </>
  );
}

function AnalysisPage() {
  const [limit, setLimit] = useState('40');
  const [seed, setSeed] = useState('');
  const [stateCode, setStateCode] = useState('NY');
  const [gameId, setGameId] = useState(9);
  const [applied, setApplied] = useState({ limit: 40, seed: undefined as number | undefined, stateCode: 'NY', gameId: 9 });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const statesQuery = useGetLottoStates({ query: { queryKey: getGetLottoStatesQueryKey(), staleTime: 3_600_000, retry: false } });
  const states = (statesQuery.data ?? []) as LottoState[];
  const gamesParams = useMemo(() => ({ stateCode }), [stateCode]);
  const gamesQuery = useGetLottoGames(gamesParams, { query: { queryKey: getGetLottoGamesQueryKey(gamesParams), enabled: Boolean(stateCode), staleTime: 3_600_000, retry: false } });
  const games = (gamesQuery.data ?? []) as LottoGame[];
  const selectedGame = games.find((game) => game.id === gameId);
  useEffect(() => {
    if (games.length > 0 && !games.some((game) => game.id === gameId)) {
      setGameId(games[0].id);
    }
  }, [games, gameId]);
  const analysisParams = useMemo(() => ({ limit: applied.limit, seed: applied.seed, stateCode: applied.stateCode, gameId: applied.gameId }), [applied]);
  const analysisEnabled = Boolean(
    stateCode === applied.stateCode &&
    games.some((game) => game.id === applied.gameId),
  );
  const analysisQuery = useGetLottoAnalysis(analysisParams, { query: { queryKey: getGetLottoAnalysisQueryKey(analysisParams), enabled: analysisEnabled, staleTime: 60_000, retry: false } });
  const healthQuery = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), staleTime: 30_000, refetchInterval: 30_000 } });
  const analysis = analysisQuery.data as LottoAnalysis | undefined;
  const draws = (analysis?.recentDraws ?? []) as LottoDraw[];
  const filters = analysis?.ticketFilters ?? [];
  const passedFilters = filters.filter((filter) => filter.passed).length;
  const maxFrequency = Math.max(...(analysis?.frequency ?? []).map((item) => item.count), 1);
  const maxWeight = Math.max(...(analysis ? Object.values(analysis.weights) : [1]));

  function runAnalysis(event: FormEvent) {
    event.preventDefault();
    if (!selectedGame) return;
    const numericLimit = Math.min(100, Math.max(5, Number(limit) || 40));
    const numericSeed = seed.trim() ? Math.min(2147483647, Math.max(0, Number(seed))) : undefined;
    setLimit(String(numericLimit));
    setSeed(numericSeed === undefined ? '' : String(numericSeed));
    setApplied({ limit: numericLimit, seed: numericSeed, stateCode, gameId: selectedGame.id });
  }

  function resetAnalysis() {
    setLimit('40'); setSeed(''); setStateCode('NY'); setGameId(9);
    setApplied({ limit: 40, seed: undefined, stateCode: 'NY', gameId: 9 });
  }

  const stateOptions = states.map((state) => <option key={state.stateCode} value={state.stateCode}>{state.stateName}</option>);
  const gameOptions = games.map((game) => <option key={game.id} value={game.id}>{game.gameName} · {game.drawnNumbers} of {game.maxBall}</option>);

  if (statesQuery.isError) return <ErrorWorkspace onRetry={() => statesQuery.refetch()} message="Could not load the state list from RapidAPI. Check that the connected account is subscribed and its API host is configured with the provider subdomain, not the full URL." />;
  if (gamesQuery.isError) return <ErrorWorkspace onRetry={() => gamesQuery.refetch()} message="Could not load games for this state from RapidAPI." />;
  if (statesQuery.isLoading || gamesQuery.isLoading || analysisQuery.isLoading || (!analysis && !analysisQuery.isError)) return <LoadingWorkspace />;
  if (analysisQuery.isError || !analysis) return <ErrorWorkspace onRetry={() => analysisQuery.refetch()} message={(analysisQuery.error as { error?: string })?.error ?? ''} />;

  return (
    <div className="grain min-h-[100dvh] bg-background">
      <div className="flex min-h-[100dvh]">
        <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} state={analysis.stateCode} game={selectedGame} />
        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-border/75 bg-background/90 px-5 backdrop-blur-md md:px-8">
            <div className="flex items-center gap-3">
              <button data-testid="button-open-mobile-nav" aria-label="Open navigation" onClick={() => setMobileOpen(true)} className="rounded-xl border border-border bg-card p-2 lg:hidden"><Menu className="h-4 w-4" /></button>
              <div className="hidden items-center gap-2 text-[11px] text-muted-foreground sm:flex"><span className="font-mono text-primary">LAB / 01</span><span className="text-border">—</span><span>Probability workspace</span></div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground sm:hidden"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Live workspace</div>
            </div>
            <div className="flex items-center gap-2">
              <div id="health" data-testid="status-health" className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[10px] font-medium text-muted-foreground sm:flex"><span className={`h-1.5 w-1.5 rounded-full ${healthQuery.isError ? 'bg-destructive' : 'bg-accent'}`} /> {healthQuery.isError ? 'Degraded' : 'Engine connected'}</div>
              <button data-testid="button-refresh-analysis" aria-label="Refresh analysis" onClick={() => analysisQuery.refetch()} className="rounded-xl border border-border bg-card p-2 text-muted-foreground transition-colors hover:text-primary"><RefreshCw className={`h-4 w-4 ${analysisQuery.isFetching ? 'animate-spin' : ''}`} /></button>
            </div>
          </header>

          <div className="mx-auto max-w-[1480px] p-5 md:p-8 xl:p-10">
            <section className="animate-rise-in mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
              <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#e8b5a7] bg-[#fff3ed] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[.16em] text-primary"><Sparkles className="h-3 w-3" /> Ensemble run complete</div>
                <h1 data-testid="text-page-title" className="max-w-[720px] font-[var(--app-font-serif)] text-[clamp(2.25rem,5vw,4.65rem)] font-semibold leading-[.96] tracking-[-.065em] text-foreground">Read the draw.<br /><span className="text-primary">Then make a choice.</span></h1>
                <p className="mt-4 max-w-[610px] text-sm leading-6 text-muted-foreground">A transparent {analysis.stateName} {analysis.gameName} analysis built from {numberFormat.format(analysis.drawsLoaded)} draws, six complementary signals, and deliberately visible constraints.</p>
              </div>
              <form onSubmit={runAnalysis} className="w-full max-w-[400px] rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-sm)]">
                <button data-testid="button-toggle-controls" type="button" onClick={() => setControlsOpen(!controlsOpen)} className="flex w-full items-center justify-between text-left">
                  <span className="flex items-center gap-2 text-xs font-bold"><SlidersHorizontal className="h-3.5 w-3.5 text-primary" /> Analysis controls</span>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${controlsOpen ? 'rotate-180' : ''}`} />
                </button>
                {controlsOpen && <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3">
                  <label className="text-[10px] text-muted-foreground">State
                    <select data-testid="select-lottery-state" value={stateCode} onChange={(event) => setStateCode(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-2.5 py-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/25">
                      {stateOptions}
                    </select>
                  </label>
                  <label className="text-[10px] text-muted-foreground">Game
                    <select data-testid="select-lottery-game" value={selectedGame?.id ?? ''} onChange={(event) => setGameId(Number(event.target.value))} disabled={gamesQuery.isLoading || games.length === 0} className="mt-1 w-full rounded-lg border border-input bg-background px-2.5 py-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50">
                      {games.length === 0 ? <option value="">No games available</option> : gameOptions}
                    </select>
                  </label>
                  <label className="text-[10px] text-muted-foreground">Draw history
                    <input data-testid="input-history-limit" type="number" min="5" max="100" value={limit} onChange={(event) => setLimit(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-2.5 py-2 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/25" />
                  </label>
                  <label className="text-[10px] text-muted-foreground">Seed <span className="text-muted-foreground/60">(optional)</span>
                    <input data-testid="input-analysis-seed" type="number" min="0" max="2147483647" value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="random" className="mt-1 w-full rounded-lg border border-input bg-background px-2.5 py-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/25" />
                  </label>
                  <p className="col-span-2 text-[9px] leading-4 text-muted-foreground">Each historical result uses a provider request. The 100-draw cap helps manage API plan limits.</p>
                  <button data-testid="button-run-analysis" type="submit" disabled={!selectedGame || gamesQuery.isLoading} className="col-span-2 mt-1 flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /> Run new analysis</button>
                </div>}
              </form>
            </section>

            <section className="animate-rise-in delay-1 grid gap-5 lg:grid-cols-[1.45fr_1fr]">
              <Panel className="relative overflow-hidden bg-sidebar text-sidebar-foreground" testId="card-recommended-ticket">
                <div className="hairline-grid absolute inset-0 opacity-30" />
                <div className="relative p-6 md:p-8">
                  <div className="flex items-start justify-between">
                    <div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-sidebar-primary">Recommended ticket</p><h2 className="mt-2 font-[var(--app-font-serif)] text-2xl font-semibold tracking-[-.045em] text-sidebar-foreground">A considered combination</h2></div>
                    <div className="flex items-center gap-1.5 rounded-full border border-sidebar-border bg-sidebar-accent/70 px-2.5 py-1.5 font-mono text-[10px] text-sidebar-foreground/65"><Target className="h-3 w-3 text-sidebar-primary" /> {analysis.ticketScore.toFixed(1)} score</div>
                  </div>
                  <div className="my-8 flex flex-wrap gap-2.5 md:gap-3">{analysis.ticket.map((number) => <NumberBall key={number} value={number} tone="dark" />)}</div>
                  <div className="grid grid-cols-3 gap-3 border-t border-sidebar-border pt-4">
                    <Metric label="Model score" value={analysis.ticketScore.toFixed(2)} detail="relative rank" accent />
                    <Metric label="Constraints" value={`${passedFilters}/${filters.length}`} detail="checks passed" />
                    <Metric label="Seed" value={applied.seed === undefined ? 'auto' : String(applied.seed)} detail="reproducibility" />
                  </div>
                </div>
              </Panel>
              <Panel className="p-6 md:p-8" testId="card-latest-draw">
                <div className="flex items-start justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Latest draw</p><p className="mt-2 text-sm font-semibold text-foreground">{formatDate(analysis.latestDraw.date)}</p></div><div className="rounded-xl bg-secondary p-2 text-primary"><Database className="h-4 w-4" /></div></div>
                <div className="my-7 flex flex-wrap gap-2">{analysis.latestDraw.numbers.map((number) => <NumberBall key={number} value={number} small />)}</div>
                <div className="flex items-end justify-between border-t border-border pt-4"><div><p className="font-mono text-[9px] uppercase tracking-[.15em] text-muted-foreground">Bonus</p><div className="mt-2">{analysis.latestDraw.bonus === null ? <span className="font-mono text-lg text-muted-foreground">—</span> : <NumberBall value={analysis.latestDraw.bonus} tone="accent" small />}</div></div><div className="text-right"><p className="font-mono text-[9px] uppercase tracking-[.15em] text-muted-foreground">Source</p><p className="mt-2 max-w-[170px] truncate text-[11px] font-medium text-foreground" title={analysis.source}>{analysis.source}</p></div></div>
              </Panel>
            </section>

            <section className="animate-rise-in delay-2 mt-8 grid gap-5 md:grid-cols-4">
              <Panel className="p-4"><Metric label="History loaded" value={numberFormat.format(analysis.drawsLoaded)} detail="observations" /></Panel>
              <Panel className="p-4"><Metric label="Filter integrity" value={`${Math.round((passedFilters / Math.max(filters.length, 1)) * 100)}%`} detail={`${passedFilters} of ${filters.length} passed`} accent /></Panel>
              <Panel className="p-4"><Metric label="Signals blended" value={String(analysis.signals.length)} detail="ensemble inputs" /></Panel>
              <Panel className="p-4"><Metric label="Generated" value={formatDate(analysis.generatedAt)} detail="latest run" /></Panel>
            </section>

            <section id="signals" className="animate-rise-in delay-3 mt-10 grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
              <Panel className="p-6 md:p-7" testId="card-model-signals">
                <SectionTitle eyebrow="01 / Ensemble" title="What moved the needle" icon={BrainCircuit} action={<span className="font-mono text-[10px] text-muted-foreground">{analysis.signals.length} active signals</span>} />
                <div>{analysis.signals.map((signal, index) => <SignalRow key={`${signal.name}-${index}`} signal={signal} index={index} />)}</div>
              </Panel>
              <Panel className="p-6 md:p-7" testId="card-model-weights">
                <SectionTitle eyebrow="02 / Blend" title="Model contribution" icon={Layers3} action={<Info className="h-4 w-4 text-muted-foreground" />} />
                <div className="space-y-4">
                  {Object.entries(analysis.weights).map(([name, weight]) => <div key={name} data-testid={`weight-row-${name}`}><div className="mb-1.5 flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[.11em] text-muted-foreground">{name}</span><span className="font-mono text-xs font-medium text-foreground">{weight.toFixed(3)}</span></div><div className="h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${Math.max(4, (weight / maxWeight) * 100)}%` }} /></div></div>)}
                </div>
                <div className="mt-7 border-t border-border pt-4 text-[11px] leading-5 text-muted-foreground">Weights are the ensemble’s current emphasis, not certainty. They help show how the recommendation was assembled.</div>
              </Panel>
            </section>

            <section className="mt-10 grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
              <Panel className="p-6 md:p-7" testId="card-ticket-filters">
                <SectionTitle eyebrow="03 / Guardrails" title="Ticket filter status" icon={ShieldIcon} action={<span className="rounded-full bg-secondary px-2 py-1 font-mono text-[10px] text-muted-foreground">{passedFilters}/{filters.length}</span>} />
                <div className="space-y-2">{filters.map((filter, index) => <FilterRow key={`${filter.name}-${index}`} filter={filter} index={index} />)}</div>
              </Panel>
              <Panel className="p-6 md:p-7" testId="card-lag-correlations">
                <SectionTitle eyebrow="04 / Time" title="Lag correlations" icon={TrendingUp} action={<span className="font-mono text-[10px] text-muted-foreground">absolute signal</span>} />
                <div className="overflow-x-auto scrollbar-thin"><table className="w-full min-w-[430px] text-left"><thead className="border-b border-border font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground"><tr><th className="pb-2 font-medium">Lag</th><th className="pb-2 font-medium">Correlation</th><th className="pb-2 text-right font-medium">Direction</th></tr></thead><tbody>{analysis.lags.map((lag, index) => <LagRow key={`${lag.lag}-${index}`} lag={lag} index={index} />)}</tbody></table></div>
              </Panel>
            </section>

            <section id="history" className="mt-10 grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
              <Panel className="overflow-hidden" testId="card-recent-history">
                <div className="p-6 pb-3 md:p-7 md:pb-3"><SectionTitle eyebrow="05 / Record" title="Recent draw history" icon={History} action={<span className="font-mono text-[10px] text-muted-foreground">{draws.length} shown</span>} /></div>
                {draws.length === 0 ? <div className="mx-6 mb-6 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No recent draws were returned by the source.</div> : <div className="overflow-x-auto scrollbar-thin"><table className="w-full min-w-[520px] text-left"><thead className="border-y border-border bg-secondary/40 font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground"><tr><th className="px-6 py-2.5 font-medium md:px-7">Draw date</th><th className="px-3 py-2.5 font-medium">Numbers</th><th className="px-6 py-2.5 text-right font-medium md:px-7">Bonus</th></tr></thead><tbody>{draws.slice(0, 8).map((draw, index) => <tr data-testid={`row-draw-${index}`} key={`${draw.date}-${index}`} className="border-b border-border/70 last:border-0"><td className="whitespace-nowrap px-6 py-3 font-mono text-[10px] text-muted-foreground md:px-7">{formatShortDate(draw.date)}</td><td className="px-3 py-3"><div className="flex gap-1.5">{draw.numbers.map((number) => <NumberBall key={number} value={number} small />)}</div></td><td className="px-6 py-3 text-right md:px-7">{draw.bonus === null ? <span className="font-mono text-xs text-muted-foreground">—</span> : <NumberBall value={draw.bonus} tone="accent" small />}</td></tr>)}</tbody></table></div>}
              </Panel>
              <Panel className="p-6 md:p-7" testId="card-frequency">
                <SectionTitle eyebrow="06 / Distribution" title="Number frequency" icon={BarChart3} action={<span className="font-mono text-[10px] text-muted-foreground">top 10</span>} />
                <div className="space-y-3">{analysis.frequency.slice(0, 10).map((item, index) => <div data-testid={`frequency-row-${item.number}`} key={item.number} className="flex items-center gap-3"><NumberBall value={item.number} small /><div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary"><div className={`h-full rounded-full ${index < 3 ? 'bg-primary' : 'bg-accent/60'}`} style={{ width: `${Math.max(4, (item.count / maxFrequency) * 100)}%` }} /></div><span className="w-8 text-right font-mono text-[11px] tabular-nums text-muted-foreground">{item.count}</span></div>)}</div>
              </Panel>
            </section>

            <section className="mt-10 grid gap-5 lg:grid-cols-[1fr_.9fr]">
              <Panel className="p-6 md:p-7" testId="card-transitions">
                <SectionTitle eyebrow="07 / Sequence" title="Transition insights" icon={ArrowUpRight} action={<span className="font-mono text-[10px] text-muted-foreground">next-number tendencies</span>} />
                <div className="grid gap-2 sm:grid-cols-2">{analysis.transitions.slice(0, 8).map((transition, index) => <div data-testid={`transition-${index}`} key={`${transition.from}-${transition.to}-${index}`} className="flex items-center justify-between rounded-xl border border-border bg-background/50 px-3 py-2.5"><div className="flex items-center gap-2"><NumberBall value={transition.from} small /><ArrowDownRight className="h-3.5 w-3.5 text-muted-foreground" /><NumberBall value={transition.to} small /></div><span className="font-mono text-[11px] font-medium text-primary">{(transition.probability * 100).toFixed(1)}%</span></div>)}</div>
              </Panel>
              <Panel id="method" className="relative overflow-hidden bg-[#e9efe9] p-6 md:p-7" testId="card-method-notes">
                <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full border-[18px] border-[#bed3c5]/55" /><div className="absolute -right-2 -top-2 h-20 w-20 rounded-full border border-[#bed3c5]/60" />
                <SectionTitle eyebrow="08 / Method" title="A readable instrument" icon={FlaskConical} />
                <p className="max-w-[370px] text-sm leading-6 text-[#53675b]">This is not a promise machine. Each run makes its assumptions inspectable: history window, seed, weighted models, filters, and the latest public draw.</p>
                <div className="mt-6 grid grid-cols-2 gap-3"><div className="rounded-xl border border-[#cbdccf] bg-[#f4f8f2]/70 p-3"><p className="font-mono text-[9px] uppercase tracking-[.15em] text-[#64816e]">Source</p><p className="mt-2 text-xs font-semibold text-[#344b3b]">Public NY Lotto</p></div><div className="rounded-xl border border-[#cbdccf] bg-[#f4f8f2]/70 p-3"><p className="font-mono text-[9px] uppercase tracking-[.15em] text-[#64816e]">Approach</p><p className="mt-2 text-xs font-semibold text-[#344b3b]">Ensemble blend</p></div></div>
              </Panel>
            </section>

            <footer className="mt-12 flex flex-col justify-between gap-3 border-t border-border py-6 text-[10px] text-muted-foreground sm:flex-row"><p>Northstar Lab · {analysis.stateName} {analysis.gameName} ensemble analysis</p><p className="flex items-center gap-1.5"><Info className="h-3 w-3" /> For inspection and entertainment, never a guarantee.</p></footer>
          </div>
        </main>
      </div>
      {controlsOpen && <button data-testid="button-reset-controls" onClick={resetAnalysis} className="fixed bottom-5 right-5 z-10 hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-2 font-mono text-[10px] text-muted-foreground shadow-[var(--shadow-md)] transition-colors hover:text-primary sm:flex"><RotateCcw className="h-3 w-3" /> Reset controls</button>}
    </div>
  );
}

function FilterRow({ filter, index }: { filter: LottoFilter; index: number }) {
  return <div data-testid={`filter-row-${index}`} className="flex items-start gap-3 rounded-xl border border-border/70 bg-background/40 p-3"><div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${filter.passed ? 'bg-[#dfeee4] text-accent' : 'bg-[#f7ded7] text-primary'}`}>{filter.passed ? <CircleCheck className="h-3.5 w-3.5" /> : <CircleX className="h-3.5 w-3.5" />}</div><div className="min-w-0"><div className="flex items-center gap-2"><p className="text-xs font-semibold text-foreground">{filter.name}</p><span className={`font-mono text-[9px] uppercase tracking-[.1em] ${filter.passed ? 'text-accent' : 'text-primary'}`}>{filter.passed ? 'pass' : 'review'}</span></div><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{filter.description}</p></div></div>;
}

function LagRow({ lag, index }: { lag: LottoLag; index: number }) {
  const positive = lag.correlation >= 0;
  return <tr data-testid={`lag-row-${index}`} className="border-b border-border/70 last:border-0"><td className="py-3 font-mono text-xs font-medium text-foreground">t−{lag.lag}</td><td className="py-3"><div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, lag.absoluteCorrelation * 100)}%` }} /></div><span className="font-mono text-[10px] text-muted-foreground">{lag.absoluteCorrelation.toFixed(3)}</span></div></td><td className={`py-3 text-right font-mono text-[10px] ${positive ? 'text-accent' : 'text-primary'}`}>{positive ? '+' : '−'} {Math.abs(lag.correlation).toFixed(3)}</td></tr>;
}

function ShieldIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.9 8.5 7 10 4.1-1.5 7-5.4 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
}

export default AnalysisPage;