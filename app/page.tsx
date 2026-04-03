"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db, googleProvider } from "@/lib/firebase";

type Point = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

type StockResponse = {
  symbol: string;
  name: string;
  lastRefreshed: string;
  latestClose: number;
  previousClose: number;
  points: Point[];
};

type WatchlistItem = {
  symbol: string;
  latestClose: number;
  updatedAt?: unknown;
};

type RangeOption = {
  key: string;
  label: string;
  days: number;
};

type ChartMode = "line" | "candlestick";

const CHART = {
  width: 1000,
  height: 360,
  paddingTop: 20,
  paddingRight: 28,
  paddingBottom: 40,
  paddingLeft: 72,
} as const;

const RANGE_OPTIONS: RangeOption[] = [
  { key: "3d", label: "3D", days: 3 },
  { key: "5d", label: "5D", days: 5 },
  { key: "1w", label: "1W", days: 7 },
  { key: "1m", label: "1M", days: 30 },
  { key: "2m", label: "2M", days: 60 },
  { key: "3m", label: "3M", days: 90 },
];

function findClosestPoint(points: Point[], targetDate: Date): Point | null {
  const targetISO = targetDate.toISOString().slice(0, 10);
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const pointISO = points[i].date;
    if (pointISO <= targetISO) {
      return points[i];
    }
  }
  return null;
}

function getPeriodReturn(points: Point[], days: number) {
  if (points.length < 2) {
    return null;
  }

  const latest = points[points.length - 1];
    const targetDate = new Date();
    // include today as one of the days; subtract days-1 to make range inclusive of today
    targetDate.setDate(targetDate.getDate() - Math.max(days - 1, 0));
    // normalize to start of day for reliable comparisons
    targetDate.setHours(0, 0, 0, 0);
  const startPoint = findClosestPoint(points, targetDate);

  if (!startPoint || startPoint.close === 0) {
    return null;
  }

  const absolute = latest.close - startPoint.close;
  const percent = (absolute / startPoint.close) * 100;

  return {
    startDate: startPoint.date,
    endDate: latest.date,
    startPrice: startPoint.close,
    endPrice: latest.close,
    absolute,
    percent,
  };
}

function getRangePoints(points: Point[], days: number) {
  if (!points.length) {
    return [] as Point[];
  }

  const targetDate = new Date();
    // include today as one of the days; subtract days-1 to make range inclusive
    targetDate.setDate(targetDate.getDate() - Math.max(days - 1, 0));
    // normalize targetDate to start of day so comparisons with point dates (00:00) work
    targetDate.setHours(0, 0, 0, 0);

  const targetISO = targetDate.toISOString().slice(0, 10);
  return points.filter((point) => point.date >= targetISO);
}

function buildChartPath(
  points: Point[],
  getX: (index: number) => number,
  getY: (value: number) => number,
) {
  if (points.length < 2) {
    return "";
  }

  return points
    .map((point, index) => {
      const x = getX(index);
      const y = getY(point.close);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function formatDateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "2-digit",
  }).format(date);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function Home() {
  const searchParams = useSearchParams();
  const lastQuickOpenKeyRef = useRef("");
  const [symbolInput, setSymbolInput] = useState("AAPL");
  const [selectedRange, setSelectedRange] = useState(RANGE_OPTIONS[2].key);
  const [manualDays, setManualDays] = useState(45);
  const [chartMode, setChartMode] = useState<ChartMode>("line");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [stockData, setStockData] = useState<StockResponse | null>(null);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState("");
  const [watchlistNotice, setWatchlistNotice] = useState("");
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setWatchlistItems([]);
      setWatchlistError("");
      setWatchlistLoading(false);
      return;
    }

    setWatchlistLoading(true);
    setWatchlistError("");

    const watchlistRef = collection(db, "users", user.uid, "watchlist");
    const unsubscribe = onSnapshot(
      watchlistRef,
      (snapshot) => {
        const items = snapshot.docs
          .map((itemDoc) => {
            const data = itemDoc.data();
            return {
              symbol: String(data.symbol ?? itemDoc.id).toUpperCase(),
              latestClose: Number(data.latestClose ?? 0),
              updatedAt: data.updatedAt,
            } as WatchlistItem;
          })
          .sort((a, b) => a.symbol.localeCompare(b.symbol));

        setWatchlistItems(items);
        setWatchlistLoading(false);
      },
      () => {
        setWatchlistLoading(false);
        setWatchlistError("Could not load your watchlist right now.");
      },
    );

    return () => unsubscribe();
  }, [user]);

  const activeDays = useMemo(() => {
    if (selectedRange === "manual") {
      return Math.min(Math.max(manualDays, 1), 3650);
    }

    const activeRange = RANGE_OPTIONS.find((option) => option.key === selectedRange);
    return activeRange?.days ?? RANGE_OPTIONS[0].days;
  }, [manualDays, selectedRange]);

  const selectedReturn = useMemo(() => {
    if (!stockData) {
      return null;
    }

    return getPeriodReturn(stockData.points, activeDays);
  }, [activeDays, stockData]);

  const selectedRangePoints = useMemo(() => {
    if (!stockData) {
      return [] as Point[];
    }

    return getRangePoints(stockData.points, activeDays);
  }, [activeDays, stockData]);

  const priceScale = useMemo(() => {
    if (!selectedRangePoints.length) {
      return null;
    }

    const lows = selectedRangePoints.map((point) => point.low);
    const highs = selectedRangePoints.map((point) => point.high);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const range = max - min || 1;
    const top = CHART.paddingTop;
    const bottom = CHART.height - CHART.paddingBottom;
    const drawable = bottom - top;

    return {
      min,
      max,
      getY: (price: number) => bottom - ((price - min) / range) * drawable,
    };
  }, [selectedRangePoints]);

  const getX = (index: number) => {
    if (selectedRangePoints.length < 2) {
      return CHART.paddingLeft;
    }

    const left = CHART.paddingLeft;
    const right = CHART.width - CHART.paddingRight;
    const width = right - left;
    return left + (index / (selectedRangePoints.length - 1)) * width;
  };

  const chartPath = useMemo(() => {
    if (!priceScale) {
      return "";
    }

    return buildChartPath(selectedRangePoints, getX, priceScale.getY);
  }, [priceScale, selectedRangePoints]);

  const yTicks = useMemo(() => {
    if (!priceScale) {
      return [] as { price: number; y: number }[];
    }

    const steps = 5;
    return Array.from({ length: steps }, (_, index) => {
      const ratio = index / (steps - 1);
      const price = priceScale.max - (priceScale.max - priceScale.min) * ratio;
      return { price, y: priceScale.getY(price) };
    });
  }, [priceScale]);

  const xTicks = useMemo(() => {
    if (!selectedRangePoints.length) {
      return [] as { x: number; label: string }[];
    }

    const steps = 5;
    return Array.from({ length: steps }, (_, index) => {
      const pointIndex = Math.round(
        (index / (steps - 1)) * (selectedRangePoints.length - 1),
      );
      return {
        x: getX(pointIndex),
        label: formatDateLabel(selectedRangePoints[pointIndex].date),
      };
    });
  }, [selectedRangePoints]);

  const hoverPoint = useMemo(() => {
    if (hoverIndex === null) {
      return null;
    }

    return selectedRangePoints[hoverIndex] ?? null;
  }, [hoverIndex, selectedRangePoints]);

  const dailyChange = useMemo(() => {
    if (!stockData || stockData.previousClose === 0) {
      return null;
    }

    const absolute = stockData.latestClose - stockData.previousClose;
    const percent = (absolute / stockData.previousClose) * 100;
    return { absolute, percent };
  }, [stockData]);

  const fetchStockData = useCallback(async (symbol: string, days: number) => {
    setError("");
    setLoading(true);

    try {
      const response = await fetch(
        `/api/stock?symbol=${encodeURIComponent(symbol)}&days=${encodeURIComponent(String(days))}`,
      );
      const data = (await response.json()) as StockResponse & { error?: string };

      if (!response.ok) {
        setStockData(null);
        setError(data.error ?? "Unable to load stock data right now.");
        return;
      }

      setStockData(data);
      setHoverIndex(null);
    } catch {
      setStockData(null);
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const nextSymbol = searchParams.get("symbol")?.trim().toUpperCase();
    if (!nextSymbol) {
      return;
    }

    const rangeFromUrl = searchParams.get("range")?.toLowerCase();
    const matchedRange = RANGE_OPTIONS.find((option) => option.key === rangeFromUrl);
    const nextDays = matchedRange?.days ?? RANGE_OPTIONS[2].days;
    const quickOpenKey = `${nextSymbol}:${nextDays}`;

    if (lastQuickOpenKeyRef.current === quickOpenKey) {
      return;
    }

    lastQuickOpenKeyRef.current = quickOpenKey;

    if (matchedRange) {
      setSelectedRange(matchedRange.key);
    }

    setSymbolInput(nextSymbol);
    void fetchStockData(nextSymbol, nextDays);
  }, [fetchStockData, searchParams]);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void fetchStockData(symbolInput, activeDays);
  }

  async function handleGoogleLogin() {
    setAuthError("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch {
      setAuthError("Google login failed. Please try again.");
    }
  }

  async function handleGoogleLogout() {
    setAuthError("");
    setWatchlistNotice("");
    try {
      await signOut(auth);
    } catch {
      setAuthError("Could not sign out right now.");
    }
  }

  async function handleSaveToWatchlist() {
    if (!user || !stockData) {
      setWatchlistNotice("Please sign in to save stocks.");
      return;
    }

    try {
      const ref = doc(db, "users", user.uid, "watchlist", stockData.symbol);
      await setDoc(
        ref,
        {
          symbol: stockData.symbol,
          latestClose: stockData.latestClose,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      setWatchlistNotice(`${stockData.symbol} saved to your watchlist.`);
    } catch {
      setWatchlistNotice("Could not save this stock to watchlist.");
    }
  }

  const watchlistPreview = watchlistItems.slice(0, 4);

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 p-5 pt-20 md:p-10 md:pt-24">
      <div className="fixed right-0 top-0 z-[60] m-2 sm:m-4">
        {authLoading ? (
          <p className="text-xs text-zinc-400">Checking login...</p>
        ) : user ? (
          <div className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-black/90 px-2 py-2 backdrop-blur">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt="Profile"
                className="h-[30px] w-[30px] rounded-full border border-zinc-700"
              />
            ) : (
              <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-xs font-bold text-zinc-300">
                {user.displayName?.slice(0, 1).toUpperCase() || "U"}
              </div>
            )}
            <button
              type="button"
              onClick={handleGoogleLogout}
              className="rounded-lg border border-zinc-600 bg-black px-3 py-1.5 text-sm font-semibold text-white hover:border-zinc-400"
            >
              Logout
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleGoogleLogin}
            className="rounded-lg border border-white bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
          >
            Login with Google
          </button>
        )}
      </div>
      <header className="rise-in rounded-2xl border border-zinc-800 bg-zinc-950/85 p-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-zinc-400">
            Alpha Vantage Stock Lens
          </p>
          <h1 className="mt-3 text-3xl font-black leading-tight text-white md:text-4xl">
            Search a stock, choose a return period, and view the chart.
          </h1>

          <div className="mt-6 rounded-xl border border-zinc-800 bg-black/40 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
                Watchlist Preview
              </p>
              <Link
                href="/watchlist"
                className="text-xs font-semibold uppercase tracking-[0.15em] text-white underline-offset-4 hover:underline"
              >
                View full watchlist
              </Link>
            </div>

            {!user ? (
              <p className="text-sm text-zinc-400">
                Sign in to see your watchlist stocks here.
              </p>
            ) : watchlistLoading ? (
              <p className="text-sm text-zinc-400">Loading watchlist...</p>
            ) : watchlistError ? (
              <p className="text-sm text-red-300">{watchlistError}</p>
            ) : watchlistPreview.length ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {watchlistPreview.map((item) => (
                  <div
                    key={item.symbol}
                    className="rounded-lg border border-zinc-800 bg-zinc-950 p-3"
                  >
                    <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Ticker</p>
                    <p className="mt-1 text-xl font-black text-white">{item.symbol}</p>
                    <p className="mt-1 text-sm font-semibold text-zinc-300">
                      {formatCurrency(item.latestClose)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-400">
                No stocks saved yet. Search and save stocks to build your watchlist.
              </p>
            )}
          </div>
        </div>
      </header>

      <section className="rise-in rounded-2xl border border-zinc-800 bg-zinc-950/85 p-5">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-zinc-400">
          1. Search
        </p>
        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
            <input
              value={symbolInput}
              onChange={(event) => setSymbolInput(event.target.value.toUpperCase())}
              placeholder="e.g. AAPL, MSFT, TSLA"
              className="h-12 flex-1 rounded-xl border border-zinc-700 bg-black px-4 font-bold uppercase tracking-[0.06em] text-white outline-none transition focus:border-white"
            />
            <button
              type="submit"
              disabled={loading || !symbolInput.trim()}
              className="h-12 rounded-xl border border-white bg-white px-6 font-bold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Loading..." : "Fetch Stock"}
            </button>
          </form>

          {error ? (
            <p className="mt-3 rounded-xl border border-red-600/50 bg-red-950/35 px-4 py-3 text-sm font-medium text-red-300">
              {error}
            </p>
          ) : null}

          {stockData ? (
            <article className="mt-4 space-y-4 rounded-2xl border border-zinc-800 bg-black/50 p-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.2em] text-zinc-500">Ticker</p>
                  <h2 className="text-2xl font-black text-white">{stockData.symbol}</h2>
                </div>
                <p className="text-xs font-semibold text-zinc-400">
                  Last refreshed: {stockData.lastRefreshed}
                </p>
              </div>

              <div className="flex flex-wrap items-end gap-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Latest close</p>
                  <p className="text-3xl font-black text-white">
                    {formatCurrency(stockData.latestClose)}
                  </p>
                </div>
                {dailyChange ? (
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Daily move</p>
                    <p
                      className={`text-lg font-extrabold ${
                        dailyChange.percent >= 0 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {formatPercent(dailyChange.percent)}
                    </p>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={handleSaveToWatchlist}
                  className="rounded-lg border border-zinc-600 bg-black px-4 py-2 text-sm font-semibold text-white hover:border-zinc-400"
                >
                  Save to Watchlist
                </button>
              </div>

              {watchlistNotice ? (
                <p className="text-sm text-zinc-300">{watchlistNotice}</p>
              ) : null}
            </article>
          ) : null}
      </section>

      <section className="rise-in rounded-2xl border border-zinc-800 bg-zinc-950/85 p-5">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-zinc-400">
          2. Select Time Return
        </p>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setSelectedRange(option.key)}
                className={`rounded-lg px-3 py-2 text-sm font-bold transition ${
                  selectedRange === option.key
                    ? "bg-white text-black"
                    : "border border-zinc-700 bg-black text-white hover:border-zinc-500"
                }`}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelectedRange("manual")}
              className={`rounded-lg px-3 py-2 text-sm font-bold transition ${
                selectedRange === "manual"
                  ? "bg-white text-black"
                  : "border border-zinc-700 bg-black text-white hover:border-zinc-500"
              }`}
            >
              Manual
            </button>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="text-sm text-zinc-300">Manual days:</label>
          <input
            type="number"
            min={1}
            max={3650}
            value={manualDays}
            onChange={(event) => {
              setSelectedRange("manual");
              setManualDays(Number(event.target.value) || 1);
            }}
            className="h-10 w-36 rounded-lg border border-zinc-700 bg-black px-3 font-semibold text-white outline-none focus:border-white"
          />
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">
            Active window: {activeDays} days
          </p>
        </div>
      </section>

      <section className="rise-in rounded-2xl border border-zinc-800 bg-zinc-950/85 p-5">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-zinc-400">
          3. Chart & Return
        </p>

        {!stockData ? (
          <div className="rounded-xl border border-dashed border-zinc-700 bg-black/35 p-5 text-sm text-zinc-400">
            Search for a stock to draw the chart for the selected period.
          </div>
        ) : selectedReturn ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setChartMode("line")}
                className={`rounded-lg px-3 py-2 text-sm font-bold transition ${
                  chartMode === "line"
                    ? "bg-white text-black"
                    : "border border-zinc-700 bg-black text-white"
                }`}
              >
                Line
              </button>
              <button
                type="button"
                onClick={() => setChartMode("candlestick")}
                className={`rounded-lg px-3 py-2 text-sm font-bold transition ${
                  chartMode === "candlestick"
                    ? "bg-white text-black"
                    : "border border-zinc-700 bg-black text-white"
                }`}
              >
                Candlestick
              </button>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-black/35 p-4">
              {chartPath && priceScale ? (
                <div className="relative">
                  <svg
                    viewBox={`0 0 ${CHART.width} ${CHART.height}`}
                    className="h-72 w-full"
                  >
                    {yTicks.map((tick) => (
                      <g key={tick.y}>
                        <line
                          x1={CHART.paddingLeft}
                          x2={CHART.width - CHART.paddingRight}
                          y1={tick.y}
                          y2={tick.y}
                          stroke="rgba(255,255,255,0.12)"
                          strokeDasharray="4 4"
                        />
                        <text
                          x={CHART.paddingLeft - 10}
                          y={tick.y + 4}
                          textAnchor="end"
                          fill="rgba(255,255,255,0.72)"
                          fontSize="12"
                        >
                          {formatCurrency(tick.price)}
                        </text>
                      </g>
                    ))}

                    {xTicks.map((tick, index) => (
                      <g key={`${tick.label}-${index}`}>
                        <line
                          x1={tick.x}
                          x2={tick.x}
                          y1={CHART.paddingTop}
                          y2={CHART.height - CHART.paddingBottom}
                          stroke="rgba(255,255,255,0.07)"
                        />
                        <text
                          x={tick.x}
                          y={CHART.height - 10}
                          textAnchor="middle"
                          fill="rgba(255,255,255,0.72)"
                          fontSize="12"
                        >
                          {tick.label}
                        </text>
                      </g>
                    ))}

                    {chartMode === "line" ? (
                      <>
                        <path
                          d={chartPath}
                          fill="none"
                          stroke="rgba(255,255,255,0.2)"
                          strokeWidth="7"
                        />
                        <path
                          d={chartPath}
                          fill="none"
                          stroke={selectedReturn.percent >= 0 ? "#22c55e" : "#ef4444"}
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </>
                    ) : (
                      selectedRangePoints.map((point, index) => {
                        const x = getX(index);
                        const yOpen = priceScale.getY(point.open);
                        const yClose = priceScale.getY(point.close);
                        const yHigh = priceScale.getY(point.high);
                        const yLow = priceScale.getY(point.low);
                        const candleWidth =
                          selectedRangePoints.length > 90
                            ? 3
                            : selectedRangePoints.length > 45
                              ? 5
                              : 7;
                        const color = point.close >= point.open ? "#22c55e" : "#ef4444";
                        const bodyTop = Math.min(yOpen, yClose);
                        const bodyHeight = Math.max(Math.abs(yOpen - yClose), 1.4);

                        return (
                          <g key={`${point.date}-${x}`}>
                            <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth="1.5" />
                            <rect
                              x={x - candleWidth / 2}
                              y={bodyTop}
                              width={candleWidth}
                              height={bodyHeight}
                              fill={color}
                              rx="1"
                            />
                          </g>
                        );
                      })
                    )}

                    {hoverPoint && priceScale ? (
                      <>
                        <line
                          x1={getX(hoverIndex ?? 0)}
                          y1={CHART.paddingTop}
                          x2={getX(hoverIndex ?? 0)}
                          y2={CHART.height - CHART.paddingBottom}
                          stroke="rgba(255,255,255,0.45)"
                          strokeDasharray="3 4"
                        />
                        <circle
                          cx={getX(hoverIndex ?? 0)}
                          cy={priceScale.getY(hoverPoint.close)}
                          r="4.5"
                          fill={hoverPoint.close >= hoverPoint.open ? "#22c55e" : "#ef4444"}
                          stroke="black"
                          strokeWidth="1.5"
                        />
                      </>
                    ) : null}

                    <rect
                      x={CHART.paddingLeft}
                      y={CHART.paddingTop}
                      width={CHART.width - CHART.paddingLeft - CHART.paddingRight}
                      height={CHART.height - CHART.paddingTop - CHART.paddingBottom}
                      fill="transparent"
                      onMouseMove={(event) => {
                        if (!selectedRangePoints.length) {
                          return;
                        }

                        const bounds = event.currentTarget.getBoundingClientRect();
                        const offsetX = event.clientX - bounds.left;
                        const ratio = Math.min(Math.max(offsetX / bounds.width, 0), 1);
                        const nextIndex = Math.round(
                          ratio * (selectedRangePoints.length - 1),
                        );
                        setHoverIndex(nextIndex);
                      }}
                      onMouseLeave={() => setHoverIndex(null)}
                    />
                  </svg>

                  {hoverPoint ? (
                    <div
                      className="pointer-events-none absolute top-3 z-10 rounded-lg border border-zinc-700 bg-black/95 px-3 py-2 text-xs text-white"
                      style={{
                        left: `${(getX(hoverIndex ?? 0) / CHART.width) * 100}%`,
                        transform: "translateX(-50%)",
                      }}
                    >
                      <p className="font-semibold text-zinc-200">{formatDateLabel(hoverPoint.date)}</p>
                      <p>Open: {formatCurrency(hoverPoint.open)}</p>
                      <p>High: {formatCurrency(hoverPoint.high)}</p>
                      <p>Low: {formatCurrency(hoverPoint.low)}</p>
                      <p className="font-semibold">Close: {formatCurrency(hoverPoint.close)}</p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="py-12 text-center text-zinc-400">Not enough data points for a chart.</p>
              )}
            </div>

            <div className="space-y-4 rounded-xl border border-zinc-800 bg-black/35 p-5">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Selected return</p>
                <p
                  className={`text-4xl font-black ${
                    selectedReturn.percent >= 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {formatPercent(selectedReturn.percent)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-zinc-800 bg-black p-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Start</p>
                  <p className="font-bold text-white">{selectedReturn.startDate}</p>
                  <p className="text-zinc-400">{formatCurrency(selectedReturn.startPrice)}</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-black p-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">End</p>
                  <p className="font-bold text-white">{selectedReturn.endDate}</p>
                  <p className="text-zinc-400">{formatCurrency(selectedReturn.endPrice)}</p>
                </div>
              </div>
              <p
                className={`text-sm font-semibold ${
                  selectedReturn.absolute >= 0 ? "text-green-400" : "text-red-400"
                }`}
              >
                Absolute change: {formatCurrency(selectedReturn.absolute)}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-700 bg-black/35 p-5 text-sm text-zinc-400">
            Not enough historical points available for this period.
          </div>
        )}
      </section>
    </div>
  );
}
