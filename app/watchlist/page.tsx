"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { collection, deleteDoc, doc, onSnapshot } from "firebase/firestore";
import { auth, db, googleProvider } from "@/lib/firebase";

type WatchlistItem = {
  symbol: string;
  latestClose: number;
  updatedAt?: unknown;
};

type SortOption =
  | "symbol-asc"
  | "symbol-desc"
  | "price-asc"
  | "price-desc"
  | "updated-asc"
  | "updated-desc";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatUpdatedAt(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format((value as { toDate: () => Date }).toDate());
  }

  return "Not available";
}

function toTimestampMs(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }

  return 0;
}

export default function WatchlistPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState("");
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>("symbol-asc");
  const [removingSymbol, setRemovingSymbol] = useState("");

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
      setWatchlistLoading(false);
      setWatchlistError("");
      return;
    }

    setWatchlistLoading(true);
    setWatchlistError("");

    const watchlistRef = collection(db, "users", user.uid, "watchlist");
    const unsubscribe = onSnapshot(
      watchlistRef,
      (snapshot) => {
        const items = snapshot.docs.map((itemDoc) => {
          const data = itemDoc.data();
          return {
            symbol: String(data.symbol ?? itemDoc.id).toUpperCase(),
            latestClose: Number(data.latestClose ?? 0),
            updatedAt: data.updatedAt,
          } as WatchlistItem;
        });

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

  async function handleGoogleLogin() {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch {
      setWatchlistError("Google login failed. Please try again.");
    }
  }

  async function handleGoogleLogout() {
    setWatchlistError("");
    try {
      await signOut(auth);
    } catch {
      setWatchlistError("Could not sign out right now.");
    }
  }

  async function handleRemove(symbol: string) {
    if (!user) {
      return;
    }

    setRemovingSymbol(symbol);
    setWatchlistError("");

    try {
      await deleteDoc(doc(db, "users", user.uid, "watchlist", symbol));
    } catch {
      setWatchlistError(`Could not remove ${symbol} from watchlist.`);
    } finally {
      setRemovingSymbol("");
    }
  }

  const sortedWatchlist = useMemo(() => {
    const items = [...watchlistItems];

    switch (sortBy) {
      case "symbol-desc":
        return items.sort((a, b) => b.symbol.localeCompare(a.symbol));
      case "price-asc":
        return items.sort((a, b) => a.latestClose - b.latestClose);
      case "price-desc":
        return items.sort((a, b) => b.latestClose - a.latestClose);
      case "updated-asc":
        return items.sort((a, b) => toTimestampMs(a.updatedAt) - toTimestampMs(b.updatedAt));
      case "updated-desc":
        return items.sort((a, b) => toTimestampMs(b.updatedAt) - toTimestampMs(a.updatedAt));
      case "symbol-asc":
      default:
        return items.sort((a, b) => a.symbol.localeCompare(b.symbol));
    }
  }, [sortBy, watchlistItems]);

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 p-5 pt-20 md:p-10 md:pt-24">
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

      <section className="rise-in rounded-2xl border border-zinc-800 bg-zinc-950/85 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-zinc-400">
              Your Watchlist
            </p>
            <h1 className="mt-2 text-3xl font-black leading-tight text-white md:text-4xl">
              Saved stocks in one place.
            </h1>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-zinc-700 bg-black px-4 py-2 text-sm font-semibold text-white hover:border-zinc-500"
          >
            Back to Stock Lens
          </Link>
        </div>
      </section>

      <section className="rise-in rounded-2xl border border-zinc-800 bg-zinc-950/85 p-5">
        {!user ? (
          <div className="rounded-xl border border-zinc-800 bg-black/35 p-5 text-sm text-zinc-300">
            Sign in with Google to view your full watchlist.
          </div>
        ) : watchlistLoading ? (
          <div className="rounded-xl border border-zinc-800 bg-black/35 p-5 text-sm text-zinc-300">
            Loading your watchlist...
          </div>
        ) : watchlistError ? (
          <div className="rounded-xl border border-red-600/50 bg-red-950/35 p-5 text-sm text-red-300">
            {watchlistError}
          </div>
        ) : watchlistItems.length ? (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-black/30 px-4 py-3">
              <p className="text-sm text-zinc-300">
                {watchlistItems.length} {watchlistItems.length === 1 ? "stock" : "stocks"}
              </p>
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                Sort by
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortOption)}
                  className="rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white outline-none focus:border-white"
                >
                  <option value="symbol-asc">Symbol (A-Z)</option>
                  <option value="symbol-desc">Symbol (Z-A)</option>
                  <option value="price-desc">Price (High-Low)</option>
                  <option value="price-asc">Price (Low-High)</option>
                  <option value="updated-desc">Updated (Newest)</option>
                  <option value="updated-asc">Updated (Oldest)</option>
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sortedWatchlist.map((item) => (
              <article
                key={item.symbol}
                className="rounded-xl border border-zinc-800 bg-black/45 p-4"
              >
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Ticker</p>
                <h2 className="mt-1 text-2xl font-black text-white">{item.symbol}</h2>
                <p className="mt-2 text-lg font-semibold text-zinc-200">
                  {formatCurrency(item.latestClose)}
                </p>
                <p className="mt-3 text-xs text-zinc-500">
                  Updated: {formatUpdatedAt(item.updatedAt)}
                </p>

                <div className="mt-4 flex gap-2">
                  <Link
                    href={`/?symbol=${encodeURIComponent(item.symbol)}&range=1m`}
                    className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-white hover:border-zinc-400"
                  >
                    Open in Chart
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleRemove(item.symbol)}
                    disabled={removingSymbol === item.symbol}
                    className="rounded-lg border border-red-700 bg-red-950/40 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-red-200 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {removingSymbol === item.symbol ? "Removing..." : "Remove"}
                  </button>
                </div>
              </article>
              ))}
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-black/35 p-5 text-sm text-zinc-300">
            No watchlist stocks yet. Go back to Stock Lens and save stocks to your watchlist.
          </div>
        )}
      </section>
    </main>
  );
}
