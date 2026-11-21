# Mindset — pre-trading meditation & mental conditioning

Mindset is a calm preparation space. Personal trading mantras play as a slow,
full-screen slideshow over gentle generated ambience, with an optional
breathing guide first. When Edge Review has enough evidence, Mindset suggests
a session aimed at the trader's recurring weaknesses.

> Review → identify weaknesses → reinforce better behaviours → prepare mentally → trade → review again.

## Structure

| Concern | Where |
|---|---|
| Default mantras (stable keys) | `src/domain/mindset/defaults.ts` |
| Options & defaults (durations, environments, sounds, breathing patterns) | `src/domain/mindset/options.ts` |
| Session state machine (pure reducer) | `src/domain/mindset/session.ts` |
| Breathing timing | `src/domain/mindset/breathing.ts` |
| Mantra selection | `src/domain/mindset/selection.ts` |
| Edge Review → recommendations (rule-based) | `src/domain/mindset/recommendations.ts` |
| Persistence & read model | `src/server/services/mindset.service.ts`, `src/actions/mindset.actions.ts`, `src/lib/validation/mindset.ts` |
| Audio engine (single shared instance) | `src/components/mindset/ambient-audio.ts` |
| Visual environments | `src/components/mindset/environment-backdrop.tsx` |
| Session orchestration | `src/components/mindset/meditation-session.tsx` (with `mantra-slideshow`, `breathing-guide`) |
| Dashboard | `src/components/mindset/mindset-dashboard.tsx` (with `session-setup`, `mantra-library`, `session-history`, `recommendation-card`) |

## Data

- `MindsetMantra`: user-owned mantras.
  - `category` is free text, so traders can create their own groups.
  - Defaults carry a `defaultKey`. Seeding is claimed once via `MindsetPreference.defaultsSeededAt` and guarded by a unique `(userId, defaultKey)` index, so revisiting never duplicates.
  - Deletes are soft, so a deleted default is never re-added.
- `MindsetPreference`: the last-used settings (environment, duration, time per mantra, order, repeat, selection, sound, volume, breathing). It also stores the dismissed recommendation key.
- `MindsetSession`: history only (start, planned and active time, completed/interrupted, environment, sound, categories, whether it came from a recommendation). Nothing is scored. There are no streaks or leaderboards.

## Audio

The app ships no audio files, and external URLs would make the core experience
fragile. Each ambience (rainfall, flowing water, ambient pad, night ambience) is
therefore **synthesized with the Web Audio API**:

- **Seamless loops:** looped white noise has no audible seam; all colour comes from filters applied after the loop.
- **Gentle changes:** soft oscillators drift slowly, and every level change is a ramp (3 s fade in, 1.6 s fade out). There are no lyrics or percussion.
- **One instance:** a single shared engine plays at most one sound. Switching sounds fades the previous one out.
- **Autoplay-safe:** the AudioContext is created inside the Begin or Preview click.
- **Fallback:** where Web Audio is missing, sessions run silently.

A licensed audio file could be added later as another sound option.

## Session robustness

- **One clock:** a single 100 ms interval drives a pure reducer. A single tick is clamped, so a throttled tab can't fast-forward, and repeated clicks are idempotent.
- **Tab hidden:** the session and audio pause.
- **Leaving early:** the session is recorded as interrupted, exactly once. Cleanup is deferred, so React's development double-mount isn't mistaken for leaving.
- **Audio stop:** audio stops when the last session closes.
- **Breathing cap:** breathing never takes more than half the session.

## Recommendations (Edge Review → Mindset)

- **Evidence:** only *finalized* Weekly Trade Audits count, and only the tags the trader recorded in them:
  - underlying weaknesses and why a trade was invalid;
  - execution issues;
  - weaknesses and miss reasons on missed setups.
- **Mapping:** each tag maps to a pattern, and each pattern to mantra categories:

  | Pattern | Evidence tags | Categories |
  |---|---|---|
  | Patience | impatience, FOMO, overtrading | Patience, Discipline |
  | Confirmation | early entry, no confirmation, entry timing | Discipline, Patience |
  | Emotional control | revenge (weakness or reason) | Emotional Control |
  | Risk | risk management, risk violation, stop placement | Risk Management |
  | Discipline | lack of discipline, no valid setup, outside conditions | Discipline |
  | Trusting the process | premature exit, interference, fear/hesitation | Self-confidence, Emotional Control |

- **Recurrence threshold:** a pattern is recommended only when it recurs, meaning at least 3 occurrences across at least 2 of the last 6 finalized reviews. One isolated mistake never triggers it, and with too little history the normal experience is shown.
- **Mantras used:** the session uses the trader's own enabled mantras in those categories, with the most relevant ones first. If the trader has none there, it shows suggested mantras for that session only. The saved library is never changed.
- **Dismissal:** dismissing stores the recommendation's evidence key. A new finalized review produces a new key, so fresh evidence can surface again.
- **Extending it:** add a pattern and its tags in `recommendations.ts`. Nothing else changes.
