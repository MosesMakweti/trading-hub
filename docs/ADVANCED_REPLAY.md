# Advanced replay: playback, sessions, drawing → order, session library

This document extends the simulation terminal (`docs/SIMULATION_PLATFORM.md`) and the replay performance work (`docs/REPLAY_PERFORMANCE.md`). It does not replace the replay engine. The server-authoritative, forward-only account clock is unchanged. Every feature below either moves that clock through the existing step path or only reads what the clock has already revealed.

## 1. Playback

| Concept | Where | Notes |
|---|---|---|
| Chart timeframe | `ws.charts[i].timeframe` | Sets how each chart aggregates. Independent of playback. |
| Playback timeframe | `ws.replay.playbackTf` (`PLAYBACK_TIMEFRAMES`: M1–H1) | Sets how far one playback step moves. Offers only multiples of the M1 data; there are no seconds or ticks. |
| Speed | `ws.replay.speedMs` (50 ms – 60 s; presets 100 ms – 10 s; custom value allowed) | Milliseconds between playback steps. Can change while playing. |
| Scheduler | `domain/charting/playback-scheduler.ts` | Deadline-based, so timing drift doesn't add up. When the browser falls behind, it sends one `CANDLE count=n` request and the server settles every bar in between, so no bar is ever skipped. |

- **Controls** (floating toolbar, `components/charting/replay-bar.tsx`): previous chart-timeframe boundary, previous playback bar, timeline slider, play/pause, playback timeframe, next playback bar, next chart candle, speed, sessions, time, Live, More (jump to date/time, finish the day, dock top/bottom/floating, reset, hide), pin and collapse.
- **Keyboard:** ← and → move one playback bar. Shift+← and Shift+→ move one chart candle.
- **Aggregation:** higher timeframes are built only from the M1 bars that have been revealed. There is a test checking that 30 × M1 steps produce the same H/L/C/volume and forming/closed state as one M30 step (`sim-playback.test.ts`).
- **Moving backward (review mode):** the clock never moves backward. Instead the client holds a view cut-off `asOf` ≤ clock:
  - Charts reload with `asOf`, which the server clamps to the clock (`getSimCandles`). The reloaded chart matches, bar for bar, what the chart showed when the clock stood at that minute.
  - `reviewTargetAction` resolves "back one bar", "previous boundary" and seeks, but never past the clock.
  - Trading is disabled while reviewing, and a badge says so. Pressing Live returns to the clock.
- **Jumping forward:** SEEK goes through the normal step path. With `align: AT_OR_AFTER` and an exclusive `until`, a jump lands inside the target window or does not move at all. It never lands on an unrelated later bar.

**Preload.** The server-side bar buffer (`market-data/bar-cache.ts`) keeps the next days of M1 bars in memory and prefetches after each step (two days ahead, which covers well over the 2-hour minimum). Physically loaded bars and visible bars are deliberately kept apart: preloaded bars stay on the server and are never sent to the browser before the clock reveals them. This is a decision, not a gap. The alternative, a browser-side buffer of future bars, would let future data leak into devtools.

## 2. Floating toolbar

`replay-bar-layout.ts` stores the toolbar position as a fraction of the free space, so it survives resizing. It is clamped inside the chart area. It can be docked top or bottom (8 px margin), pinned (dragging disabled), collapsed or hidden. Everything is saved in the workspace (`ws.replay.bar`).

## 3. Trading sessions

- **Definitions** (`domain/charting/sessions.ts`): each session is defined in its own time zone, so daylight saving follows that place's calendar.
  - Built-in sessions:
    - Asian: 19:00–04:00 New York time, overnight.
    - Tokyo: 09:00–18:00 Tokyo time.
    - London: 08:00–17:00 London time.
    - New York: 08:00–17:00 New York time.
    - London–New York overlap: the true intersection of London and New York, so it is shorter in the weeks when US and UK daylight saving differ.
- **Data time zone:** MT5 bars carry no zone, so the trader sets the broker's. The default `NYC+7` (GMT+2/+3, New York close at 00:00) is the common MT5 convention. Occurrences are converted session-local time → UTC → data minute.
- **Custom sessions:** stored in the `UserTradingSession` table.
  - Fields: name, start/end (an overnight session is allowed), IANA zone, days, colour, notes, enabled.
  - Create, edit, duplicate, enable/disable and delete are owner-scoped, with at most 50 sessions per user.
- **Navigator:** pick a session and date to see its chart-time window, then jump to Prev, Start, End or Next.
  - Start lands on the first bar inside the session. If the session has no data, the replay doesn't move and a toast says so.
  - A target at or before the clock enters review mode. A later target moves the replay forward.
- **On the chart:** shading, running high/low, and labels for each session shown, computed only from revealed bars.

## 4. Position drawing ↔ order entry

Setting: **Sync position drawing with order entry** (`ws.trading.syncPositionDrawing`, on by default). The checkbox is under the order ticket.

- **Linking:** selecting a LONG or SHORT drawing links it to the ticket. The link stays (`linkedId`) until another position drawing is selected, it is unlinked, or the drawing is deleted. Only one drawing is linked at a time, and every drawing's status shows in the drawing manager.
- **Drawing → ticket:**
  - Side comes from the direction.
  - Order type comes from the entry against the quote: a long below the ask is a limit, above it a stop; a short mirrors this against the bid.
  - Price = entry, stop = the drawing's stop, take profit = TP1.
  - The ticket overwrites only the fields whose value actually changed, so text the trader is typing isn't overwritten.
- **Ticket → drawing:** editing the price, stop or take profit moves the drawing through `DrawingController.update`, which is undoable. There is no loop: unchanged values are not written back.
- **Risk preview** (`domain/charting/order-sync.ts`): an estimate of size, money at risk and R:R from the instrument's contract spec (value per price unit, quantity step). If no spec is available, no size is shown; the preview never guesses. The server sizes the real order.
- **Placing:** a drafted order always asks for confirmation; the drawing never trades on its own. `placeSimOrderAction` then:
  1. Checks the drawing, before the order is placed: it must be the trader's, on this account and instrument, and its direction must match the side (`requireOrderDrawing`).
  2. Validates the order exactly like a typed one.
  3. Records `data.orderRef` on the drawing on the server (`linkDrawingToOrder`). A client can neither forge nor clear this field: `saveSimDrawing` drops it from client input and keeps the stored value.
- **Statuses:** draft, linked to ticket, order pending, position open, executed. They come from `orderRef` together with the account's live orders and positions.
- **Deleting a drawing with a working order** leaves the order in place but offers "Cancel order".

## 5. Session library (`/backtesting/sessions`)

`server/services/simulation/session-library.service.ts` covers three kinds of session: Strategy Lab accounts, Prop Firm accounts and legacy Backtest Runs.

- **Browse:** search by name or instrument, filter by type, show Active / Archived / All, sort by updated, newest, name or trades. Each row shows counts: trades, orders, drawings and observations.
- **Rename:** any kind.
- **Duplicate (Lab only):** creates a new account with the same pins, period, balance, currency, frozen rules and strategy. It has no trades and the clock is not started.
- **Archive and restore:**
  - For Lab and Prop accounts, archive is a flag (`archivedAt`) and the account's status isn't touched, so restore returns it exactly as it was. Older status-based archives restore to a status that matches the account's history.
  - Legacy runs keep their existing ARCHIVED status semantics.
- **Delete:** the confirmation shows what goes with the session, and the trader must type its name.
  - Lab: cascades to orders, fills, ledger, events and drawings. Study observations are kept, with their account link cleared.
  - Legacy: the existing run delete, including media cleanup.
  - Prop Firm accounts can't be deleted, because fees, breaches and payouts are append-only financial records. `deleteSimAccount` refuses them as well. They can be archived.
- **Access control:** every operation is owner-scoped on the server, and the kind must match the row. A test checks that another user can't list, rename, archive, duplicate, inspect or delete a session.

## 6. Limits

- No sub-minute playback. The data is M1, and seconds or ticks are never simulated.
- Moving backward is review mode, not rewinding the account. Orders and fills stay where they happened.
- Session separators are drawn as shading and labels, not as separate vertical lines.
- There is no auto-execute mode for drawings, by design.
- The risk preview converts nothing. When the instrument's quote currency differs from the account's, the preview says the server will do the conversion.
