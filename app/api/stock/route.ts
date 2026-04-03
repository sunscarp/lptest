import { NextResponse } from "next/server";

type AlphaVantageSeries = {
  [date: string]: {
    "1. open": string;
    "2. high": string;
    "3. low": string;
    "4. close": string;
  };
};

type NormalizedPoint = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

const BASE_URL = "https://www.alphavantage.co/query";
const FALLBACK_API_KEY = "HPX9HTEC7T9BHRIX";
const STOCK_FUNCTION = "TIME_SERIES_DAILY";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.trim().toUpperCase();

  if (!symbol) {
    return NextResponse.json(
      { error: "Please provide a stock symbol." },
      { status: 400 },
    );
  }

  const apiKey = process.env.ALPHA_VANTAGE_API_KEY ?? FALLBACK_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Alpha Vantage API key is missing." },
      { status: 500 },
    );
  }

  const daysParam = Number(searchParams.get("days") || "0");

  // choose series type based on requested window to avoid premium 'full' requirement
  // daily (compact) returns recent ~100 points; weekly/monthly provide longer history
  let func = "TIME_SERIES_DAILY";
  let seriesKey = "Time Series (Daily)";

  if (daysParam > 365 * 2) {
    func = "TIME_SERIES_MONTHLY";
    seriesKey = "Monthly Time Series";
  } else if (daysParam > 120) {
    func = "TIME_SERIES_WEEKLY";
    seriesKey = "Weekly Time Series";
  }

  const url = `${BASE_URL}?function=${func}&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    const rawData = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch stock data." },
        { status: response.status },
      );
    }

    if (rawData.Note) {
      return NextResponse.json(
        {
          error:
            "Alpha Vantage rate limit reached. Please wait a minute and try again.",
        },
        { status: 429 },
      );
    }

    if (rawData.Information) {
      const info = String(rawData.Information).toLowerCase();
      const isRateLimited =
        info.includes("frequency") ||
        info.includes("per minute") ||
        info.includes("per day") ||
        info.includes("rate limit") ||
        info.includes("please visit") ||
        info.includes("thank you for using alpha vantage");

      const isPremiumEndpoint =
        info.includes("premium") &&
        (info.includes("endpoint") || info.includes("requires") || info.includes("subscription"));

      const message = isRateLimited
        ? "Alpha Vantage rate limit reached. Please wait a minute and try again."
        : isPremiumEndpoint
          ? "The requested Alpha Vantage endpoint requires a premium plan."
          : "Alpha Vantage returned an informational response. Please try again shortly.";

      return NextResponse.json(
        { error: message },
        { status: isRateLimited ? 429 : 502 },
      );
    }

    if (rawData["Error Message"]) {
      return NextResponse.json(
        {
          error: `Symbol ${symbol} was not found. Please verify the ticker.`,
        },
        { status: 404 },
      );
    }

    const series = rawData[seriesKey] as AlphaVantageSeries | undefined;

    if (!series) {
      return NextResponse.json(
        { error: `No series returned (${seriesKey}) for this symbol.` },
        { status: 404 },
      );
    }

    const points: NormalizedPoint[] = Object.entries(series)
      .map(([date, values]) => ({
        date,
        open: Number(values["1. open"]),
        high: Number(values["2. high"]),
        low: Number(values["3. low"]),
        close: Number(values["4. close"]),
      }))
      .filter(
        (point) =>
          Number.isFinite(point.open) &&
          Number.isFinite(point.high) &&
          Number.isFinite(point.low) &&
          Number.isFinite(point.close),
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    if (!points.length) {
      return NextResponse.json(
        { error: "No valid close prices were found for this symbol." },
        { status: 404 },
      );
    }

    const latest = points[points.length - 1];
    const previous = points[points.length - 2];

    return NextResponse.json({
      symbol,
      name: rawData["Meta Data"]?.["2. Symbol"] ?? symbol,
      lastRefreshed: rawData["Meta Data"]?.["3. Last Refreshed"] ?? latest.date,
      latestClose: latest.close,
      previousClose: previous?.close ?? latest.close,
      points,
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not connect to Alpha Vantage. Check your internet connection and try again.",
      },
      { status: 500 },
    );
  }
}