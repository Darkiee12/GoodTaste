import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";

import {
  exchangeRatesFn,
  supportedCurrenciesFn,
} from "@/modules/restaurant-discovery/restaurant.functions";
import { currencyPreferenceFn, saveCurrencyPreferenceFn } from "@/modules/user/currency.functions";
import { convertAmount, formatMoney, isCurrency } from "@/shared/money";
import type { ExchangeRate } from "@/shared/money";

const preferenceKey = ["currency-preference"];

const localCurrency = () => {
  try {
    const saved = localStorage.getItem("feastjourney.currency");

    return saved !== null && isCurrency(saved) ? saved : "";
  } catch {
    return "";
  }
};

const subscribeToCurrency = (notify: () => void) => {
  window.addEventListener("storage", notify);
  window.addEventListener("feastjourney-currency", notify);

  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener("feastjourney-currency", notify);
  };
};

export function usePreferredCurrency() {
  const client = useQueryClient();
  const local = useSyncExternalStore(subscribeToCurrency, localCurrency, () => "");
  const [choice, setChoice] = useState<string>();
  const [storageError, setStorageError] = useState(false);

  const account = useQuery({
    queryKey: preferenceKey,
    queryFn: () => currencyPreferenceFn(),
    staleTime: 60000,
    retry: false,
  });

  const supported = useQuery({
    queryKey: ["supported-currencies"],
    queryFn: () => supportedCurrenciesFn(),
    staleTime: 86400000,
    retry: false,
  });

  const save = useMutation({
    mutationFn: (currency: string | null) => saveCurrencyPreferenceFn({ data: { currency } }),
    onSuccess: (result) =>
      client.setQueryData(preferenceKey, { member: true, currency: result.preferred_currency }),
  });

  const currency = choice ?? account.data?.currency ?? local;

  return {
    currency,
    codes: supported.data ?? [],
    loading: supported.isPending,
    unavailable: supported.isError,
    storageError,
    saving: save.isPending,
    error: save.isError || account.isError,
    change: (code: string) => {
      setChoice(code);

      try {
        localStorage.setItem("feastjourney.currency", code);
        window.dispatchEvent(new Event("feastjourney-currency"));
      } catch {
        setStorageError(true);
      }

      if (account.data?.member === true) save.mutate(code === "" ? null : code);
    },
  };
}

export function CurrencySelector({
  preference,
}: {
  preference: ReturnType<typeof usePreferredCurrency>;
}) {
  return (
    <div className="currency-selector">
      <label htmlFor="preferred-currency">Show approximate equivalents in</label>
      <select
        id="preferred-currency"
        value={preference.currency}
        onChange={(event) => preference.change(event.target.value)}
        disabled={preference.saving}
      >
        <option value="">Original currencies only</option>
        {preference.currency !== "" && !preference.codes.includes(preference.currency) && (
          <option value={preference.currency}>{preference.currency}</option>
        )}
        {preference.codes.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      {preference.loading && <small aria-live="polite">Loading currency choices…</small>}
      {preference.unavailable && (
        <small aria-live="polite">
          Currency choices are temporarily unavailable. Original prices are still shown.
        </small>
      )}
      {preference.saving && <small aria-live="polite">Saving account preference…</small>}
      {preference.error && (
        <small aria-live="polite">
          Account currency could not be saved or loaded. Your local choice is available for this
          visit.
        </small>
      )}
      {preference.storageError && (
        <small aria-live="polite">This browser cannot remember currency preferences.</small>
      )}
    </div>
  );
}

export function useExchangeRates(bases: ReadonlyArray<string>, quote: string) {
  const unique = [...new Set(bases)].filter((base) => base !== quote).toSorted();

  const query = useQuery({
    queryKey: ["exchange-rates", quote, unique],
    queryFn: () => exchangeRatesFn({ data: { bases: unique, quote } }),
    enabled: quote !== "" && unique.length > 0 && unique.length <= 12,
    staleTime: 3600000,
    retry: false,
  });

  const rates: ReadonlyMap<string, ExchangeRate> = new Map(
    (query.data ?? []).map((rate) => [rate.base, rate]),
  );

  return { rates, unavailable: query.isError || unique.length > 12, loading: query.isFetching };
}

export function ObservedPrice({
  amount,
  currency,
  locale,
  rate,
}: {
  amount: string;
  currency: string;
  locale: string;
  rate?: ExchangeRate;
}) {
  let converted: string | null = null;

  if (rate !== undefined && rate.quote !== currency)
    converted = convertAmount(amount, currency, rate.quote, rate);

  return (
    <div className="observed-price">
      <p className="text-xl font-semibold tabular-nums">
        {formatMoney(amount, currency, locale)}{" "}
        <span className="text-xs font-normal">{currency}</span>
      </p>
      {converted !== null && rate !== undefined && (
        <p
          className="text-sm text-muted italic tabular-nums"
          title={`Reference rate ${rate.effectiveDate} · ${rate.provider}`}
        >
          ≈ {formatMoney(converted, rate.quote, locale)} {rate.quote}
          <span className="block text-xs">Rate dated {rate.effectiveDate}</span>
        </p>
      )}
    </div>
  );
}
