# Resonance — Adaptive Sound State Generator

Resonance generates real-time sound environments designed to help you reach a desired mental state — focus, relaxation, sleep, energy, meditation, or sensual arousal. Instead of playing pre-recorded tracks, it synthesizes everything algorithmically in the browser with the Web Audio API: colored noise, binaural beat pairs, isochronic-style rhythmic pulses, and pure tones, all mixed per state and intensity.

You don't need to know anything about frequencies. Pick how you want to feel, how deep, and for how long — the app builds the soundscape, runs the session, and asks how well it worked. Over time those ratings (plus implicit signals like early stops and volume tweaks) become the training data for personalization: the app gradually learns which sound configurations work best *for you*. That feedback loop is the core idea — see `PRD.txt` for the full product spec.

Because everything is generated algorithmically, the app ships no audio files and works fully offline. When you do want the sound elsewhere — a phone without the app, a car stereo, a cheap speaker — the Download button renders the selected session (up to 60 minutes, including its slow evolution arc) to an MP3 you can play in any audio player. MP3 encoding uses [@breezystack/lamejs](https://github.com/shijinyu/lamejs) (LGPL-3.0), the only non-React runtime dependency.

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
npm test          # run the unit tests (Vitest)
```

## How it works

The whole app is client-side: Vite + React + TypeScript, with a framework-agnostic audio engine in plain TS on top of the Web Audio API.

**Audio graph** (`src/audio/engine.ts`):

```
tone ─┬→ stereo width ─┐
noise ┘                ├→ mix bus → pulse modulator → master gain → lowpass → limiter → mono gate → output
binaural ──────────────┘
```

- **Noise** — white / pink / brown / blue, generated in an AudioWorklet with decorrelated stereo channels (`src/audio/noise-processor.ts`).
- **Binaural beats** — an oscillator pair hard-panned left/right (carrier ± beat/2). It deliberately bypasses the stereo-width matrix, which would otherwise destroy the effect. In mono/speaker mode it's automatically substituted with a pulsed tone at the carrier frequency.
- **Isochronic pulses** — amplitude modulation on the mix bus (`src/audio/pulseModulator.ts`), in two modes: *simple* (the original steady sine LFO) or *pattern* (a musical BPM grid with a continuous complexity control that fades in off-beat subdivisions, backbeat accents, and 16th-note ghost fills — `src/audio/rhythm/pattern.ts`). Pattern pulses are pre-scheduled smooth envelopes; in-flight pulses are never cancelled, so tempo and complexity can sweep live without clicks.
- **Click-free by construction** — every audible parameter change goes through ramps (`src/audio/ramp.ts`); sessions always fade in and fade out. A limiter, per-layer loudness trims, and a capped master volume act as the loudness ceiling.

**Sessions**: each mental state (`src/audio/states.ts`) maps the intensity slider onto concrete engine parameters — beat frequency within the state's range, modulation depth, noise type and level. The session controller (`src/session/sessionController.ts`) runs a wall-clock timer with pause/resume, recovers from audio interruptions (e.g. another app grabbing the output), and handles per-state endings — sleep fades to silence over a minute with no chime; focus can end with an optional gentle chime.

- **Harmonic pad** — a chord-like layer (`src/audio/layers/harmonyLayer.ts`): root, fifth, octave, and third voices whose upper voices fade in continuously with a `richness` control (equal-power normalized, so richness never changes loudness), plus very slow free-running undulation (`movement`) for perceptible harmonic motion. A `bass` control drives a low-shelf in the master chain (0 to +6 dB at 150 Hz).

**Timed programs** (`src/programs/`): design a session as absolute-time phases — e.g. 0–3 min warm low-intensity ambience at 70–80 BPM, 3–8 min introduce the pulse at 85–90, 8–15 min build complexity at 90–100, 15–25 min peak at 95–110, then an open-ended sustain. Each phase sets intensity, a BPM range (the tempo drifts deterministically inside it), rhythmic complexity, and optional texture scalers (noise/ambience/tone/brightness/harmony/bass, plus an absolute warmth override). Phases crossfade over 30 s at their boundaries. Programs are authored in a visual segment editor, saved like presets, and drive the engine through the same side channel as session evolution — so saved presets and the personalizer never see the churn. Program sessions skip the bandit and mid-session adaptation: the program owns the session's shape.

New programs start from a **template**: blank, the 5-phase build arc, or one of six *context* templates (💗 intimate, 🌹 romantic, sensual, playful, ✨ fantasy, 🔥 passionate — `src/programs/templates.ts`). Each context couples a curated base sound (harmonic pad, bass, brightness, ambience, width) with an emotional-progression arc — the design goal is an increasingly engaging, pleasant, immersive auditory environment rather than "more activation," consistent with evidence that context and emotional engagement matter more than any single frequency.

**Sound lab** (`src/ui/lab/`, or open the app with `?lab`): a test bench with no session timer — instant play/stop, every engine parameter live (including the new tempo/complexity controls), state defaults and saved presets as starting points, a program timeline you can scrub to audition any minute instantly (or play through from that point), a bounded randomizer, and one-tap audition of the personalizer's candidate arms.

**Persistence** (`src/storage/`): local-first, no account — presets, session records, and ratings live in `localStorage`. Session records double as training rows (state → configuration → outcome, plus implicit signals) for the personalizer. A JSON export/import ("Your data" on the setup screen) moves everything between devices manually; the learned statistics are rebuilt from the merged session history on import, so importing is idempotent.

**Personalization** (`src/personalization/`): a Thompson-sampling multi-armed bandit learns which sound variation works best for you, per state. Arms are perturbation *recipes* (slower/faster beat, alternate noise color, softer binaural layer, …) applied to the state's default profile at serve time. Rewards blend explicit 1–5 ratings with implicit signals — completion fraction, repeated volume tweaks, skipped ratings. The first ~6 sessions per state serve the pure §8 defaults (cold start); afterwards the app experiments unless you flip the per-state "lock what works" toggle. Completed sleep sessions are rated via a next-morning prompt on the next app open. Once a state has 5+ sessions, the "Your sound profile" screen shows what's working: most effective layers, preferred beat range, noise color, volume, and typical duration.

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
  storage/               localStorage persistence (presets, sessions, feedback) + export/import
  personalization/       bandit optimizer, reward model, morning prompt, insights
  adaptation/            mid-session adaptation policy (checkpoints → arm switches)
  coach/                 natural-language goal → session configuration
  biometrics/            heart-rate sources (Web Bluetooth / simulated) + trend
  ui/                    React components: setup → session → feedback → insights screens
```

## Status & roadmap

- **Phase 0 — Foundation** ✅ engine core + test bench
- **Phase 1 — MVP** ✅ state selection, intensity, sessions, presets, feedback, safety
- **Phase 2 — Personalization** ✅ Thompson-sampling bandit over the session data, morning prompt for sleep, lock/explore toggle, personal sound profile, JSON export/import (accounts + cloud sync deferred)
- **Phase 3 — Adaptive + AI** ✅ mid-session adaptation loop (10-minute check-ins + implicit signals → click-free arm switches), natural-language coach (local rule-based, offline), optional Web Bluetooth heart-rate input with explicit consent (HRV/movement still open)
- **Phase 4 — Timed programs + Sound lab** ✅ BPM/complexity rhythm engine, visual program editor with phase timeline, program-driven sessions, and the `?lab` test bench with timeline scrubbing
- **Phase 5 — Contexts + harmonic pad** ✅ harmonic pad layer with richness/movement, bass low-shelf, per-segment harmony/bass/warmth, and six context program templates

Known limitation: on iOS Safari the Web Audio context is suspended when the screen locks, which breaks sleep sessions — the PWA-vs-native-wrapper decision to fix this is still open (see `TODO.md`).
