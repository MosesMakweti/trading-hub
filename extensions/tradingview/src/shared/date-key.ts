/**
 * Traditorium TradingView Extension — Step 7, §25. A deliberate PORT (not an
 * import — see confluence-eligibility.ts's doc comment for why) of
 * `src/lib/date.ts::localDateToKey` — trivial date-formatting, not a
 * scoring/business formula, so porting it is the same judgment call as
 * `isConfluenceEligible`.
 *
 * WHY THIS MATTERS: `POST /api/v1/trades`'s `dateKey` is OPTIONAL — the
 * server defaults it to `localDateToKey(new Date())` when omitted
 * (src/app/api/v1/trades/route.ts), using the SERVER's own local clock/
 * timezone. That's the right default for the web app (server and browser
 * are effectively the same "local day" for a same-region deployment), but
 * an extension calling the API from the TRADER'S browser, possibly against
 * a server in a different timezone, must not rely on that default — a
 * trade logged at 11:50pm the trader's time could land on the SERVER's
 * "tomorrow" if the server's clock is ahead. The extension therefore always
 * computes and sends `dateKey` explicitly, using the trader's own local
 * `Date`, via this exact same algorithm — never UTC (Today/Journal are
 * date-keyed by local calendar day, not by UTC-midnight boundaries).
 */
export function localDateToKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
