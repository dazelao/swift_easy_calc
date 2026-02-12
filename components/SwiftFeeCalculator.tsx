/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";
type Currency = "USD" | "EUR";

type HistoryEntry = {
  id: string;
  timestamp: string;
  amount: number;
  currency: Currency;
  feeUsd: number;
  feeUah: number;
  rateDate: string;
  usdRate: number;
  eurRate: number;
  limited?: boolean;
  rawFeeUsd?: number;
  rawFeeUah?: number;
  diffUsd?: number;
  diffUah?: number;
};

type NbuRate = {
  cc: string;
  rate: number;
  exchangedate: string;
};

type NbuResponse = NbuRate[];

const MAX_FEE_USD = 90;
const SIGNIFICANT_UAH = 400_000;
const HISTORY_STORAGE_KEY = "swiftCalculatorHistory";

type Calculation = {
  feeUsd: number;
  feeUah: number;
  rawFeeUsd: number;
  rawFeeUah: number;
  diffUsd: number;
  diffUah: number;
  significantUsd: number;
  significantEur: number;
  maxFeeUah: number;
};

function getEffectiveDate(selected?: string | null): Date {
  if (selected) {
    return new Date(selected);
  }
  const now = new Date();
  if (now.getHours() < 8) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }
  return now;
}

async function fetchNbuRates(date: Date): Promise<{
  usdRate: number;
  eurRate: number;
  rateDate: string;
}> {
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const cacheKey = `nbuRates_${dateStr}`;

  if (typeof window !== "undefined") {
    const cached = window.localStorage.getItem(cacheKey);
    if (cached) {
      const data = JSON.parse(cached) as {
        usd: number;
        eur: number;
        date: string;
      };
      return {
        usdRate: data.usd,
        eurRate: data.eur,
        rateDate: data.date
      };
    }
  }

  const url = `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?date=${dateStr}&json`;
  const res = await fetch(url);
  const data = (await res.json()) as NbuResponse;

  const usd = data.find((c) => c.cc === "USD");
  const eur = data.find((c) => c.cc === "EUR");

  if (!usd || !eur) {
    throw new Error("Не знайдено курсів USD/EUR в відповіді НБУ");
  }

  const usdRate = usd.rate;
  const eurRate = eur.rate;
  const rateDate = usd.exchangedate;

  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        usd: usdRate,
        eur: eurRate,
        date: rateDate
      })
    );
  }

  return { usdRate, eurRate, rateDate };
}

export const SwiftFeeCalculator = () => {
  const [theme, setTheme] = useState<Theme>("light");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [rateDateInput, setRateDateInput] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );

  const [usdRate, setUsdRate] = useState(0);
  const [eurRate, setEurRate] = useState(0);
  const [rateDate, setRateDate] = useState("");

  const [isLoadingRates, setIsLoadingRates] = useState(false);
  const [ratesError, setRatesError] = useState<string | null>(null);

  const [copyHintVisible, setCopyHintVisible] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [calculation, setCalculation] = useState<Calculation | null>(null);

  // theme init
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("theme") as Theme | null;
    const initial: Theme = stored === "dark" || stored === "light" ? stored : "light";
    setTheme(initial);

    // history init
    const rawHistory = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (rawHistory) {
      try {
        const parsed = JSON.parse(rawHistory) as HistoryEntry[];
        if (Array.isArray(parsed)) {
          setHistory(parsed);
        }
      } catch {
        // ignore broken history
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("theme", theme);
    const body = document.body;
    if (theme === "dark") {
      body.classList.add("bg-gray-900");
      body.classList.remove("bg-gray-100");
    } else {
      body.classList.add("bg-gray-100");
      body.classList.remove("bg-gray-900");
    }
  }, [theme]);

  // load rates
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setIsLoadingRates(true);
      setRatesError(null);
      try {
        const effectiveDate = getEffectiveDate(rateDateInput);
        const { usdRate, eurRate, rateDate } = await fetchNbuRates(effectiveDate);
        if (cancelled) return;
        setUsdRate(usdRate);
        setEurRate(eurRate);
        setRateDate(rateDate);
      } catch (e) {
        if (cancelled) return;
        setRatesError(
          e instanceof Error ? e.message : "Помилка завантаження курсів НБУ"
        );
      } finally {
        if (!cancelled) {
          setIsLoadingRates(false);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [rateDateInput]);

  const computeCalculation = (): Calculation | null => {
    if (!usdRate || !eurRate) return null;

    const value = parseFloat(amount || "0") || 0;
    if (!value) return null;

    let baseUsd = 0;
    if (currency === "USD") {
      baseUsd = value;
    } else {
      baseUsd = value * (eurRate / usdRate);
    }

    const rawFeeUsd = 12 + baseUsd * 0.005;
    const feeUsd = rawFeeUsd > MAX_FEE_USD ? MAX_FEE_USD : rawFeeUsd;

    const feeUah = feeUsd * usdRate;
    const diffUsd = rawFeeUsd > MAX_FEE_USD ? rawFeeUsd - MAX_FEE_USD : 0;
    const diffUah = diffUsd * usdRate;
    const rawFeeUah = rawFeeUsd * usdRate;

    const significantUsd = SIGNIFICANT_UAH / usdRate;
    const significantEur = SIGNIFICANT_UAH / eurRate;
    const maxFeeUah = MAX_FEE_USD * usdRate;

    return {
      feeUsd,
      feeUah,
      rawFeeUsd,
      rawFeeUah,
      diffUsd,
      diffUah,
      significantUsd,
      significantEur,
      maxFeeUah
    };
  };

  const feeUahDisplay = calculation ? calculation.feeUah.toFixed(2) : "0.00";

  const persistHistory = (entries: HistoryEntry[]) => {
    setHistory(entries);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
    }
  };

  const handleCalculate = () => {
    const result = computeCalculation();
    if (!result) return;

    setCalculation(result);

    const numericAmount = parseFloat(amount || "0") || 0;
    if (!numericAmount) return;

    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: new Date().toISOString(),
      amount: numericAmount,
      currency,
      feeUsd: result.feeUsd,
      feeUah: result.feeUah,
      rateDate,
      usdRate,
      eurRate,
      limited: result.rawFeeUsd > MAX_FEE_USD,
      rawFeeUsd: result.rawFeeUsd,
      rawFeeUah: result.rawFeeUah,
      diffUsd: result.diffUsd,
      diffUah: result.diffUah
    };

    const next = [entry, ...history].slice(0, 100);
    persistHistory(next);
  };

  const handleClearHistory = () => {
    persistHistory([]);
  };

  const handleDownloadCsv = () => {
    if (!history.length || typeof window === "undefined") return;

    const header = [
      "timestamp",
      "amount",
      "currency",
      "feeUsd",
      "feeUah",
      "rateDate",
      "usdRate",
      "eurRate"
    ];

    const rows = history.map((h) =>
      [
        h.timestamp,
        h.amount.toString().replace(".", ","),
        h.currency,
        h.feeUsd.toFixed(2).replace(".", ","),
        h.feeUah.toFixed(2).replace(".", ","),
        h.rateDate,
        h.usdRate.toString().replace(".", ","),
        h.eurRate.toString().replace(".", ",")
      ].join(";")
    );

    const csv = [header.join(";"), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "swift_calc_history.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    const text = `${feeUahDisplay} грн`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopyHintVisible(true);
      setTimeout(() => setCopyHintVisible(false), 1500);
    } catch {
      // тихо игнорим, не критично
    }
  };

  const cardClasses =
    "bg-white rounded-2xl shadow-lg p-6 w-full max-w-xl space-y-4 transition-colors";

  const textMainClass = "text-black";
  const textSecondaryClass = "text-black";
  const sectionTitleClass = "text-black";
  const sectionTextClass = "text-black";
  const smallTextClass = "text-black";

  return (
    <div className="flex w-full max-w-5xl gap-4">
      {/* history sidebar */}
      <div className="w-64 shrink-0">
        <div className="bg-white rounded-2xl shadow-lg p-4 h-full flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-black">Історія викликів</h2>
            <button
              type="button"
              onClick={handleClearHistory}
              disabled={!history.length}
              className="text-xs text-red-600 disabled:text-gray-300"
            >
              очистити
            </button>
          </div>
          <div className="flex justify-between items-center mb-2">
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={!history.length}
              className="text-xs px-2 py-1 border rounded-md hover:bg-gray-100 disabled:text-gray-300 disabled:border-gray-200"
            >
              CSV
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 text-xs">
            {history.length === 0 && (
              <div className="text-gray-500 text-xs">
                Поки немає записів. Додай результат кнопкою під калькулятором.
              </div>
            )}
            {history.map((item) => {
              const limited = item.limited && item.diffUsd !== undefined;
              return (
                <div
                  key={item.id}
                  className={`border rounded-md p-2 cursor-default ${
                    limited
                      ? "bg-red-50 border-red-300 hover:bg-red-100"
                      : "hover:bg-gray-50"
                  }`}
                >
                  <div className="font-mono text-[11px] text-gray-600">
                    {new Date(item.timestamp).toLocaleString("uk-UA")}
                  </div>
                  <div>
                    {item.amount} {item.currency}
                  </div>
                  <div>
                    комісія: {item.feeUsd.toFixed(2)} USD /{" "}
                    {item.feeUah.toFixed(2)} грн
                  </div>
                  {limited && (
                    <div className="mt-1 text-[11px] text-red-700">
                      Ліміт 90 USD спрацював, економія:{" "}
                      {item.diffUsd?.toFixed(2)} USD /{" "}
                      {item.diffUah?.toFixed(2)} грн
                    </div>
                  )}
                  <div className="text-[11px] text-gray-600 mt-1">
                    курс: USD {item.usdRate.toFixed(4)}, EUR{" "}
                    {item.eurRate.toFixed(4)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* main calculator card */}
      <div className={cardClasses}>
      <h1 className={`text-xl font-semibold ${textMainClass}`}>
        SWIFT калькулятор комісії
      </h1>
      <p className={`text-sm ${textSecondaryClass}`}>
        Формула: <strong>12 + 0.5%</strong> від суми, але не більше{" "}
        <strong>90</strong> USD
        <br />
        Результат у гривнях за{" "}
        <a
          href="https://bank.gov.ua/ua/markets/exchangerates"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-blue-500 underline cursor-pointer"
        >
          офіційним курсом НБУ
        </a>
      </p>

      <div className="flex justify-between items-center gap-3">
        <div className="flex items-center gap-2">
          <label
            htmlFor="rateDateSelect"
            className={`text-sm font-medium ${textMainClass}`}
          >
            Дата курсу:
          </label>
          <input
            id="rateDateSelect"
            type="date"
            value={rateDateInput}
            onChange={(e) => setRateDateInput(e.target.value)}
            className="border rounded-lg px-2 py-1 text-sm bg-white text-gray-900"
          />
        </div>
        <button
          type="button"
          onClick={() => setTheme((prev) => (prev === "light" ? "dark" : "light"))}
          className="text-sm font-semibold px-4 py-2 border-2 border-gray-400 rounded-lg text-gray-800 bg-white hover:bg-gray-100 transition-colors"
        >
          {theme === "light" ? "🌙 Темна тема" : "☀️ Світла тема"}
        </button>
      </div>

      <div className="space-y-2">
        <label className={`block text-sm font-medium ${textMainClass}`}>
          Сума
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            step="0.01"
            placeholder="Введіть суму"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCalculate();
              }
            }}
            className="w-full border rounded-lg p-2 focus:ring focus:ring-blue-200 bg-white text-gray-900"
          />
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
            className="border rounded-lg px-2 py-2 bg-white text-gray-900"
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <button
          type="button"
          onClick={handleCalculate}
          disabled={!parseFloat(amount || "0") || !usdRate || !eurRate}
          className="mt-2 w-full text-sm px-3 py-2 border rounded-md hover:bg-gray-100 disabled:text-gray-300 disabled:border-gray-200"
        >
          розрахувати
        </button>
      </div>

      <div className="bg-gray-50 rounded-lg p-4 space-y-3">
        <div className="border-b pb-2">
          <div className={`text-sm font-semibold ${sectionTitleClass}`}>
            Значна сума на сьогодні
          </div>
          <div
            className={`grid grid-cols-3 gap-2 text-sm mt-1 ${sectionTextClass}`}
          >
            <div>{SIGNIFICANT_UAH.toLocaleString("uk-UA")} грн</div>
            <div>
              {calculation ? calculation.significantUsd.toFixed(2) : "—"} USD
            </div>
            <div>
              {calculation ? calculation.significantEur.toFixed(2) : "—"} EUR
            </div>
          </div>
        </div>

        <div className="border-b pb-2">
          <div className={`text-sm font-semibold ${sectionTitleClass}`}>
            Максимальна комісія
          </div>
          <div
            className={`grid grid-cols-2 gap-2 text-sm mt-1 ${sectionTextClass}`}
          >
            <div>
              {calculation ? calculation.maxFeeUah.toFixed(2) : "—"} грн
            </div>
            <div>{MAX_FEE_USD} USD</div>
          </div>
        </div>

        <div className={`text-sm ${sectionTextClass}`}>
          Фактична комісія (USD екв.):{" "}
          <span className="font-semibold">
            {calculation ? calculation.feeUsd.toFixed(2) : "0.00"}
          </span>
        </div>
        <div className={`text-sm flex items-center gap-2 ${sectionTextClass}`}>
          Фактична комісія (UAH):{" "}
          <span className="font-semibold">{feeUahDisplay}</span>
          <button
            type="button"
            onClick={handleCopy}
            className="text-sm px-3 py-1.5 border rounded-md hover:bg-gray-100 whitespace-nowrap"
            title="Скопіювати суму"
          >
            скопіювати
          </button>
        </div>
        <div
          className={`text-xs text-green-600 transition-opacity h-4 ${
            copyHintVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          Скопійовано
        </div>

        {calculation && calculation.rawFeeUsd > MAX_FEE_USD && (
          <div className="space-y-1 text-sm text-red-700">
            <div>
              Комісія без обмеження (USD екв.):{" "}
              <span className="font-semibold">
                {calculation.rawFeeUsd.toFixed(2)}
              </span>
            </div>
            <div>
              Комісія без обмеження (UAH):{" "}
              <span className="font-semibold">
                {calculation.rawFeeUah.toFixed(2)}
              </span>
            </div>
            <div>
              Економія завдяки ліміту 90 (USD екв.):{" "}
              <span className="font-semibold">
                {calculation.diffUsd.toFixed(2)}
              </span>
            </div>
            <div>
              Економія завдяки ліміту 90 (UAH):{" "}
              <span className="font-semibold">
                {calculation.diffUah.toFixed(2)}
              </span>
            </div>
          </div>
        )}

        <div className={`text-xs ${smallTextClass}`}>
          Курс НБУ USD:{" "}
          <span className="font-mono">
            {usdRate ? usdRate.toFixed(4) : isLoadingRates ? "..." : "—"}
          </span>
        </div>
        <div className={`text-xs ${smallTextClass}`}>
          Курс НБУ EUR:{" "}
          <span className="font-mono">
            {eurRate ? eurRate.toFixed(4) : isLoadingRates ? "..." : "—"}
          </span>
        </div>
        <div className={`text-xs ${smallTextClass}`}>
          Дата курсу НБУ: <span>{rateDate || (isLoadingRates ? "..." : "—")}</span>
        </div>

        {ratesError && (
          <div className="text-xs text-red-600 mt-1">Помилка: {ratesError}</div>
        )}
      </div>
      </div>
    </div>
  );
};

