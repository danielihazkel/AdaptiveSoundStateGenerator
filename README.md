# Resonance — Adaptive Sound State Generator

Resonance generates real-time sound environments designed to help you reach a desired mental state — focus, relaxation, sleep, energy, meditation, or sensual arousal. Instead of playing pre-recorded tracks, it synthesizes everything algorithmically in the browser with the Web Audio API: colored noise, binaural beat pairs, isochronic-style rhythmic pulses, and pure tones, all mixed per state and intensity.

You don't need to know anything about frequencies. Pick how you want to feel, how deep, and for how long — the app builds the soundscape, runs the session, and asks how well it worked. Over time those ratings (plus implicit signals like early stops and volume tweaks) become the training data for personalization: the app gradually learns which sound configurations work best *for you*. That feedback loop is the core idea — see `PRD.txt` for the full product spec.

Because everything is generated algorithmically, the app ships no audio files and works fully offline — it is an installable PWA whose app shell is precached, so it opens with no network. When you do want the sound elsewhere — a phone without the app, a car stereo, a cheap speaker — the Download button (on the setup screen, in the program editor, and in the sound lab) renders the selected session or program (up to 4 hours, including its slow evolution arc) to an MP3 you can play in any audio player. Long exports render in 15-minute chunks on separate `OfflineAudioContext`s, each streamed straight into the encoder and joined with a 2 s equal-power crossfade (the rhythm pattern is handed over exactly across the seam; free-running oscillators restart, which the crossfade masks), so peak memory stays at one chunk regardless of length. MP3 encoding uses [@breezystack/lamejs](https://github.com/shijinyu/lamejs) (LGPL-3.0), the only non-React runtime dependency.

**On phones** (`src/platform/`): a running session holds a Screen Wake Lock so the display never sleeps mid-session, and shows lock-screen / notification transport (pause, resume, stop, position) through the Media Session API. A looping silent `<audio>` element plays alongside the Web Audio graph for the life of the session — browsers only surface media controls and keep audio alive in the background for an HTMLMediaElement — and closing the tab mid-session or mid-export asks for confirmation first.

> **Not a medical device.** These soundscapes are experimental sound environments that may support focus, relaxation, or other states — individual responses vary. No claims of clinical effect are made. Listen at a safe, comfortable volume.

## Running the app

Requires [Node.js](https://nodejs.org/) 20+.

```sh
npm install
npm run dev
```

Then open http://localhost:5173/ — preferably **with headphones**, since binaural beats need true stereo separation (there's a speaker/mono fallback toggle if you don't have them).

Other scripts:

```sh
npm run build     # type-check + production build (output in dist/)
npm run preview   # serve the production build locally
npm test          # run the unit + component tests (Vitest; React suites run under jsdom)
npm run lint      # ESLint (typescript-eslint + react-hooks)
```

CI (`.github/workflows/ci.yml`) runs lint, tests, and the production build on every push and pull request.

## How it works

The whole app is client-side: Vite + React + TypeScript, with a framework-agnostic audio engine in plain TS on top of the Web Audio API.

**Audio graph** (`src/audio/engine.ts`):

```
tone ─┬→ stereo width ─┐                          ┌→ reverb send ┐
noise ┘                ├→ mix bus → pulse modulator┴→ master gain ┴→ lowpass → limiter → mono gate → output
binaural ──────────────┘
```

- **Noise** — white / pink / brown / blue, generated in an AudioWorklet with decorrelated stereo channels (`src/audio/noise-processor.ts`).
- **Binaural beats** — an oscillator pair hard-panned left/right (carrier ± beat/2). It deliberately bypasses the stereo-width matrix, which would otherwise destroy the effect. In mono/speaker mode it's automatically substituted with a pulsed tone at the carrier frequency.
- **Isochronic pulses** — amplitude modulation on the mix bus (`src/audio/pulseModulator.ts`), in two modes: *simple* (the original steady sine LFO) or *pattern* (a musical BPM grid with a continuous complexity control that fades in off-beat subdivisions, backbeat accents, and 16th-note ghost fills — `src/audio/rhythm/pattern.ts`). Pattern pulses are pre-scheduled smooth envelopes; in-flight pulses are never cancelled, so tempo and complexity can sweep live without clicks.
- **Ambience** — rain, ocean, wind, space, forest, fireplace and café, all synthesized in an AudioWorklet from shaped noise plus sparse events (bird calls, crackles, clinks — `src/audio/ambience-processor.ts`), so the app still ships no audio files. Ambience joins the graph *after* the pulse modulator so the isochronic pulse never chops it. Dropping a recording into `public/ambience/` (see the README there) makes the layer crossfade from synthesis to the recording for that type.
- **Space (reverb)** — an optional room on the pulsed tonal mix (`src/audio/reverb.ts`): a parallel send into a `ConvolverNode` whose impulse response is *synthesized* — seeded, exponentially decaying decorrelated noise (`src/audio/reverbIr.ts`), so exports build the identical room and the app still ships no audio files. `space.level` sets the wet mix (0 = exactly the pre-reverb sound), `space.size` the decay (RT60 0.6–3 s, quantized into crossfaded buckets). The wet path rides master fades, the lowpass, bass shelf, limiter and mono gate; ambience and the chime stay dry. Noise-colour and ambience-type switches crossfade equal-power *inside* their worklets — ~100 ms for a slider tap, several seconds when a timed program changes scene.
- **Click-free by construction** — every audible parameter change goes through ramps (`src/audio/ramp.ts`); sessions always fade in and fade out. A limiter, per-layer loudness trims, and a capped master volume act as the loudness ceiling.

**Sessions**: each mental state (`src/audio/states.ts`) maps the intensity slider onto concrete engine parameters — beat frequency within the state's range, modulation depth, noise type and level. The session controller (`src/session/sessionController.ts`) runs a wall-clock timer with pause/resume, recovers from audio interruptions (e.g. another app grabbing the output), and handles per-state endings — sleep fades to silence over a minute with no chime; focus can end with an optional gentle chime.

- **Harmonic pad** — a chord-like layer (`src/audio/layers/harmonyLayer.ts`): root, fifth, octave, and third voices whose upper voices fade in continuously with a `richness` control (equal-power normalized, so richness never changes loudness), plus very slow free-running undulation (`movement`) for perceptible harmonic motion. A `bass` control drives a low-shelf in the master chain (0 to +6 dB at 150 Hz).

**Timed programs** (`src/programs/`): design a session as absolute-time phases — e.g. 0–3 min warm low-intensity ambience at 70–80 BPM, 3–8 min introduce the pulse at 85–90, 8–15 min build complexity at 90–100, 15–25 min peak at 95–110, then an open-ended sustain. Each phase sets intensity, a BPM range (the tempo drifts deterministically inside it), rhythmic complexity, and optional texture scalers (noise/ambience/tone/brightness/harmony/bass, plus an absolute warmth override). A phase can also override the sound itself — the binaural beat, the carrier, the noise colour, the ambience type, the pad's richness, the reverb amount — so a program can move 14 Hz → 8 Hz or dissolve rain into a fireplace between phases: numeric overrides glide across the 30 s boundary crossfade, and type switches dissolve over a few seconds inside the worklets. Phases crossfade over 30 s at their boundaries. Programs are authored in a visual segment editor, saved like presets, and drive the engine through the same side channel as session evolution — so saved presets and the personalizer never see the churn. Program sessions skip the bandit and mid-session adaptation: the program owns the session's shape.

New programs start from a **template**: blank, the 5-phase build arc, or one of six *context* templates (💗 intimate, 🌹 romantic, sensual, playful, ✨ fantasy, 🔥 passionate — `src/programs/templates.ts`). Each context couples a curated base sound (harmonic pad, bass, brightness, ambience, width) with an emotional-progression arc — the design goal is an increasingly engaging, pleasant, immersive auditory environment rather than "more activation," consistent with evidence that context and emotional engagement matter more than any single frequency.

**Sound lab** (`src/ui/lab/`, or open the app with `?lab`): a test bench with no session timer — instant play/stop, every engine parameter live (including the new tempo/complexity controls), state defaults and saved presets as starting points, a program timeline you can scrub to audition any minute instantly (or play through from that point), a bounded randomizer, one-tap audition of the personalizer's candidate arms, and real-time timed program runs with the same pause/resume and audio-interruption recovery as a session (nothing is recorded).

**Session history** (`src/ui/HistoryScreen.tsx`): every session the device has played — when, which state, how long, how it was rated (plus the optional PRD §9 answers: was the sound distracting, would you use it again), and whether it ran a program, a preset, the coach, or adapted mid-way — with weekly totals and a day streak (`src/personalization/history.ts`). Any non-program session can be **replayed**: the exact profile it played is loaded into the next session (the personalizer and mid-session adaptation stay out of the way, as with presets), and the new record links back via `replayOfSessionId`.

**Breathing pacer & guided breathing** (`src/audio/breathing.ts`, `src/ui/BreathingPacer.tsx`): when the pulse runs at a breathing rate (the `calm` state's 0.1–0.15 Hz pulse, or any simple-mode pulse ≤ 0.5 Hz), the session screen shows an expanding/contracting circle with "Breathe in / Breathe out" cues at the same period. For calm, relax and meditation you can instead pick a **guided pattern** — box 4-4-4-4, 4-7-8, or coherent 5.5 s — and the whole mix swells with each breath (loudest at the top of the inhale, flat through holds) while the pacer shows every phase with a countdown. Sound and visual are the same pure function of elapsed time, so they never drift apart; the swell is a third mode of the pulse modulator (`src/audio/pulseModulator.ts`) fed through an engine side channel, so presets and the personalizer never see it. Honours `prefers-reduced-motion`.

**Wake-up sessions & "End at"**: the duration picker has an **End at HH:MM** mode (resolved from the wall clock when you press Begin — useful for a nap or a night's sleep). Sleep sessions can opt into **Wake me up**: instead of fading to silence, the last 3–30 minutes rise gently — louder, brighter, a faster beat (`withWakeUp` in `src/session/evolution.ts`, an evolution-arc variant so the sleep body still learns) — and the session ends with the chime; you're then offered the rating screen right away instead of the next-morning prompt.

**Interval (Pomodoro) focus** (`src/programs/intervals.ts`): for focus, flow and creative, "Work in intervals" generates a timed program from three numbers — work minutes, break minutes, cycles (default 25/5 ×4). Breaks keep the sound going but softer, slower and darker with more ambience; an optional chime marks every switch (`Program.boundaryChime`, also available on any program in the editor and rendered into MP3 exports). The generated program is not saved — the plan is recorded on the session instead.

**Shareable links** (`src/share/shareLink.ts`): any program or saved sound can be copied as a link — the whole thing is deflate-compressed into the URL hash (`#share=…`, no server). Opening the link offers to import it; everything that arrives is re-validated and normalized like a file import.

**Persistence** (`src/storage/`): local-first, no account. Settings, presets and programs live in `localStorage`; session records live in **IndexedDB** (`src/storage/sessionDb.ts`, up to 5 000 records) behind a write-through in-memory cache, so reads stay synchronous and the app renders without waiting — existing `localStorage` records are migrated on first open, verified before the old copy is retired, and `localStorage` remains the fallback wherever IndexedDB is unavailable. If a write fails (storage full), the app keeps running but shows a warning suggesting a JSON export. Opening the app in a second tab shows a warning; a playing session also holds a Web Lock, so a second tab cannot start one, and a tab refreshes its cached settings/presets/programs when another tab writes them. Background errors (rejected promises, a lazily-loaded screen that fails to fetch after an update) surface as a dismissible notice instead of a blank page; a new build announces itself with an "Update / Later" toast and only reloads when you say so — never mid-session or mid-export. Reads are guarded too: data written by a newer build is left untouched (and a copy kept under a `.quarantine` key) rather than wiped, damaged payloads are quarantined before being reset, and a per-version migration table is the path for future schema bumps. Session records double as training rows (state → configuration → outcome, plus implicit signals) for the personalizer. A JSON export/import ("Your data" on the setup screen) moves everything between devices manually; the learned statistics are rebuilt from the merged session history on import, so importing is idempotent.

**Personalization** (`src/personalization/`): a Thompson-sampling multi-armed bandit learns which sound variation works best for you, per state. Arms are perturbation *recipes* (slower/faster beat, alternate noise color, softer binaural layer, a harmonic pad on/off, more bass, a warmer tone, a different ambience, a sense of space, …) applied to the state's default profile at serve time — 14–16 per state, each gated on being audible against that state's defaults. Rewards blend explicit 1–5 ratings (and the optional distraction / use-again answers) with implicit signals — completion fraction, repeated volume tweaks, an explicitly skipped rating; replaying a session, or a preset saved from one, credits the arm that produced the sound. Evidence decays with a 60-session half-life so old ratings never pin the posterior, and every arm also keeps statistics per **serving context** (time of day × headphones/speakers), shrunk toward the state-level posterior — so "slower beat works at night" is learnable without fragmenting the data. The first 6 sessions per state serve the pure §8 defaults (cold start); afterwards the app experiments unless you flip the per-state "lock what works" toggle. Adding recipes bumps the candidate-set version and the posterior is rebuilt from the session records rather than reset. Completed sleep sessions are rated via a next-morning prompt on the next app open. Once a state has 5+ sessions, the "Your sound profile" screen shows what's working: most effective layers, every variation tried with its score and interval, what works best at which time of day, preferred beat range, noise color, volume, and typical duration.

**Adaptation** (`src/adaptation/`): during a session (Phase 3), a checkpoint fires every 10 minutes of listening time. Non-sleep sessions show a one-tap check-in (Better / Same / Worse, auto-dismissed after 30 s); "worse" — or strong implicit signals like repeated volume tweaks — glides the sound over a few seconds to a different bandit arm, preferring a variation the session already liked. Sleep sessions never prompt and never switch arms; with a heart-rate sensor connected, a rising trend softens the soundscape once. Touching the advanced panel stops adaptation for the rest of the session, and an "Adapt mid-session" toggle turns the whole loop off. Adapted sessions record a per-arm segment timeline, and each answered check-in becomes a small extra reward for its arm.

**Coach** (`src/coach/`): type "I'm tired but need to study for two hours" and a local rule-based parser (no network, no LLM) extracts goal, energy, and duration, then fills the normal setup controls — the session still flows through the personalizer, so learning is unaffected. The parser sits behind a provider interface an LLM could implement later.

**Biometrics** (`src/biometrics/`): optional and consent-gated. A Web Bluetooth heart-rate strap (standard GATT profile; Chrome/Edge only) feeds a baseline-relative trend into the adaptation loop for relax/sleep/meditation. Raw readings live only in memory — sessions keep just a per-segment summary delta. Append `?simhr` to the URL for a simulated sensor during development.

## Project layout

```
PRD.txt                  product spec (the source of truth)
TODO.md                  phased task breakdown derived from the PRD
src/
  audio/                 engine core: layers, worklet, states, ramps
  session/               session lifecycle: timer, pause/resume, interruptions
  programs/              timed sound-design programs: segment model + evaluator
  lab/                   sound-lab helpers (bounded profile randomizer)
  storage/               persistence: localStorage (settings, presets, programs) + IndexedDB session records, export/import
  personalization/       bandit optimizer, reward model, morning prompt, insights
  adaptation/            mid-session adaptation policy (checkpoints → arm switches)
  coach/                 natural-language goal → session configuration
  biometrics/            heart-rate sources (Web Bluetooth / simulated) + trend
  share/                 shareable program / preset links (URL hash, no backend)
  ui/                    React components: setup → session → feedback → insights screens
  test/                  test harness: jsdom setup, fake AudioEngine, fake IndexedDB
```

## Status & roadmap

- **Phase 0 — Foundation** ✅ engine core + test bench
- **Phase 1 — MVP** ✅ state selection, intensity, sessions, presets, feedback, safety
- **Phase 2 — Personalization** ✅ Thompson-sampling bandit over the session data, morning prompt for sleep, lock/explore toggle, personal sound profile, JSON export/import (accounts + cloud sync deferred)
- **Phase 3 — Adaptive + AI** ✅ mid-session adaptation loop (10-minute check-ins + implicit signals → click-free arm switches), natural-language coach (local rule-based, offline), optional Web Bluetooth heart-rate input with explicit consent (HRV/movement still open)
- **Phase 4 — Timed programs + Sound lab** ✅ BPM/complexity rhythm engine, visual program editor with phase timeline, program-driven sessions, and the `?lab` test bench with timeline scrubbing
- **Phase 5 — Contexts + harmonic pad** ✅ harmonic pad layer with richness/movement, bass low-shelf, per-segment harmony/bass/warmth, and six context program templates
- **Phase 8 — Robustness & learning loop** ✅ pure engine composition (`src/audio/compose.ts`) with an exact oracle test, error boundary + background-error notice, honest service-worker update toast, jsdom/Testing Library harness with hook and component tests, candidate set v3 (pad/bass/warmth/ambience arms), reward fixes (skipped ratings, replay/preset labels, recency decay), PRD §9 feedback extras, per-variation and time-of-day insights, contextual bandit, cross-tab session lock, IndexedDB session store
- **Phase 9 — Program sound overrides + reverb** ✅ per-phase absolute overrides (beat, carrier, noise colour, ambience type, pad richness, space) with gliding boundaries, parametrized worklet crossfades, and the synthesized-IR reverb send with its `space-on` bandit arm (candidate set v4)
- **Phase 7 — Breathing, wake-up, intervals, sharing** ✅ guided breathing patterns with a matching swell, "End at" durations and wake-up endings for sleep, interval (Pomodoro) sessions with boundary chimes, shareable links, plus a hardening pass (import confirmation, offline-render cleanup, code-split screens, radio-group/aria state, cross-tab warning)

Known limitation: iOS Safari may still suspend the Web Audio context when the screen locks. The silent keep-alive element and Wake Lock (iOS 16.4+) make this best-effort rather than guaranteed; a native wrapper remains the only certain fix (see `TODO.md`).
