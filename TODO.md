# Resonance — TODO

Task breakdown derived from `PRD.txt`. Section references (§) point at the PRD.

## Phase 0 — Foundation (engine core)

- [x] Scaffold project: Vite + React + TypeScript
- [x] `SoundProfile` parameter model (§5) — `src/audio/types.ts`
- [x] Ramped-parameter helper — every change click-free (§7) — `src/audio/ramp.ts`
- [x] Tone layer: sine oscillator with frequency + level (§6A) — `src/audio/layers/toneLayer.ts`
- [x] Binaural layer: L/R oscillator pair, glide-able beat frequency (§6B) — `src/audio/layers/binauralLayer.ts`
- [x] Noise layer: white / pink / brown via AudioWorklet (§6D, §7) — `src/audio/noise-processor.ts`, `src/audio/layers/noiseLayer.ts`
- [x] AudioEngine: master gain, fade-in on start, fade-out on stop (§13) — `src/audio/engine.ts`
- [x] Test UI: play/stop + live sliders for every layer — `src/App.tsx`
- [x] Verify: type-check + production build pass (`npm run build`)
- [ ] Verify by ear: `npm run dev`, press Play with headphones — layers audible, slider moves click-free, no console errors

## Phase 1 — MVP (§15)

- [x] State selection screen: Focus / Relax / Sleep / Energy / Meditation (§4 Step 1) — `src/ui/StatePicker.tsx`
- [x] Mental state profiles with per-state parameter ranges (§8) — `src/audio/states.ts`
- [x] Arousal state (sensual/intimate, experimental — not in PRD §8) — `src/audio/states.ts`, coach goal `intimacy`
- [x] Intensity slider mapped to modulation depth, beat range position, noise level (§4 Step 2) — `src/audio/states.ts`, `src/ui/SetupScreen.tsx`
- [x] Duration picker: 15/30/45/60/90/custom + session timer (§4 Step 3) — `src/ui/DurationPicker.tsx`, `src/session/sessionController.ts`
- [x] Session end behavior per state — sleep fades to silence, no chime (§4 Step 4) — `src/session/sessionController.ts`, `src/audio/chime.ts`
- [x] Pause/resume + audio interruption handling (§4) — `src/session/sessionController.ts`; lab program runs share it via `engine.subscribeContextState` (`src/lab/programRunner.ts`)
- [x] Isochronic-style amplitude modulation layer (§6C) — `src/audio/pulseModulator.ts`
- [x] Stereo width control (§5) — `src/audio/stereoWidth.ts` (binaural exempt by design)
- [x] Live parameter panel for advanced users (§15.4) — `src/ui/AdvancedPanel.tsx`
- [x] Saved presets: save + replay a liked configuration (§15.5) — `src/ui/PresetSaveRow.tsx`, `src/storage/storage.ts`
- [x] Post-session 1–5 feedback capture (§15.6, §9) — `src/ui/FeedbackScreen.tsx` (completed sleep sessions skip it; next-morning prompt is Phase 2)
- [x] Local-first persistence for sessions, feedback, presets (§14) — `src/storage/` (session records already shaped as Phase 2 training rows)
- [x] Safety: loudness ceiling (limiter + layer trims + volume cap as MVP LUFS substitute), headphone prompt + mono fallback, warnings, disclaimers (§7, §13) — `src/ui/SafetyNotices.tsx`, `src/audio/engine.ts`
- [x] Blue noise support (§6D) — `src/audio/noise-processor.ts`
- [ ] Verify by ear: full session flow with headphones — profiles sound right, mono fallback works, sleep fade + focus chime behave

## Phase 2 — V2 Personalization (§16)

- [x] Session/feedback data store: user → state → config → result (§9) — `SessionRecord` + `servedArmId`/`servedBy` tracking, `src/storage/`
- [x] Implicit signals: early stop, volume tweaks, replays, skips (§9) — skip now recorded (`feedbackSkipped`) and scored in `src/personalization/reward.ts`
- [x] Next-morning feedback prompt for sleep sessions (§9) — `src/personalization/morningPrompt.ts`, `src/ui/MorningPrompt.tsx` (in-app modal on next open, 18 h window)
- [x] Optimizer: Thompson-sampling multi-armed bandit over perturbation recipes applied to the §8 priors (§9, §16) — `src/personalization/candidates.ts`, `bandit.ts`, `personalizer.ts`; cold start = pure defaults for the first ~6 sessions per state
- [x] "Lock what works" vs "keep experimenting" toggle (§9) — per-state, `Settings.personalizationMode`, shown once past cold start
- [x] Personal sound profile screen (§10) — `src/personalization/insights.ts`, `src/ui/InsightsScreen.tsx` (≥ 5 sessions per state)
- [x] Cross-device transfer via JSON export/import (accounts deferred — §14 says they arrive "when sync becomes worthwhile"; posterior is rebuilt from merged sessions on import) — `src/storage/transfer.ts`, `src/ui/DataPanel.tsx`
- [ ] Accounts + cloud sync (§14) — deferred to its own phase; export/import covers manual transfer meanwhile -- ignore for now
- [x] Verify by ear / in-browser: bandit variations sound reasonable per state, morning prompt appears after a completed sleep session, insights read sensibly

## Phase 3 — V3 Adaptive + AI (§17, §11)

- [x] Mid-session adaptation loop: micro-prompt ("better/same/worse") + implicit signals every 10 min → arm switch/revert with a slow glide (§17) — `src/adaptation/`, `src/session/sessionController.ts` (checkpoints), `src/ui/MicroPrompt.tsx`; per-segment credit in `src/personalization/reward.ts` (`computeCredits`); sleep never prompts and never switches (biometric soften only)
- [x] AI coach: natural-language goal → engine configuration (§11) — `src/coach/` (local rule-based parser behind a provider seam for a future LLM), `src/ui/CoachInput.tsx`; fills the setup controls so bandit attribution is untouched
- [x] Optional wearable signals: heart rate via Web Bluetooth (Chrome/Edge, explicit consent per §14) + simulated dev source (`?simhr`) — `src/biometrics/`, `src/ui/BiometricsPanel.tsx`; HR trend feeds the adaptation loop for relax/sleep/meditation (HRV/movement deferred)
- [ ] Verify by ear: adapted switch glides without clicks, prompts never appear during sleep/pause/wind-down, coach fills setup from the PRD example phrase, `?simhr` rising HR softens a sleep session

## Phase 4 — Timed programs + Sound lab

- [x] Rhythm upgrade: BPM-based pattern pulse with continuous `complexity` (subdivisions/accents), backward-compatible `SoundProfile.rhythm` block (simple mode = legacy sine LFO, byte-identical) — `src/audio/rhythm/pattern.ts`, `src/audio/pulseModulator.ts` (lookahead scheduler, in-flight envelopes never cancelled), rhythm controls in `src/ui/AdvancedPanel.tsx`
- [x] Timed program model: absolute-time segments (label, intensity, BPM range, complexity, texture scalers; open-ended last segment), normalize-on-read, deterministic evaluator with 30 s boundary crossfades and in-segment BPM drift — `src/programs/types.ts`, `src/programs/evaluator.ts`
- [x] Engine side channel `setProgramModulation` (replaces the arc when active; never written into the profile) + session integration (program sessions skip bandit/adaptation, `SessionRecord.programId`) — `src/audio/engine.ts`, `src/session/sessionController.ts`, `src/App.tsx`
- [x] Visual segment editor + program persistence (`resonance.v1.programs`) + export/import + setup-screen program picker + in-session phase readout — `src/ui/ProgramEditor.tsx`, `src/storage/`, `src/ui/SetupScreen.tsx`, `src/ui/SessionScreen.tsx`
- [x] Sound lab (`?lab` or "Sound lab →" link): instant play, all parameters live, state/preset starting points, program timeline scrub + play-from-here, randomize + bandit-arm audition — `src/ui/lab/`, `src/lab/randomize.ts`
- [ ] Verify by ear: pattern mode at complexity 0 ≈ old steady pulse; BPM/complexity sweeps click-free; default 5-phase program crossfades audibly at 3/8/15/25 min; lab scrub through a program follows the phases

## Phase 5 — Contexts + harmonic pad

- [x] Harmonic pad layer: root/fifth/octave/third voices, continuous `richness` fade-in (equal-power), slow free-running `movement` LFOs, warmth-driven softness — `src/audio/layers/harmonyLayer.ts`; `SoundProfile.harmony` (disabled = legacy-identical)
- [x] Bass low-shelf (150 Hz, 0..+6 dB) in the master chain — `SoundProfile.bass`, `src/audio/engine.ts`; Bass slider in the Master panel, Harmonic pad panel in `src/ui/AdvancedPanel.tsx`
- [x] Per-segment `harmonyScale`/`bassScale`/`warmth` (absolute override) through the program evaluator + editor texture section — `src/programs/{types,evaluator}.ts`, `src/ui/ProgramEditor.tsx`
- [x] Context program templates (intimate / romantic / sensual / playful / fantasy / passionate + blank + build arc) with emotional-progression arcs; template picker in the "New program" flow — `src/programs/templates.ts`, `src/ui/SetupScreen.tsx`
- [ ] Verify by ear: richness 0→1 thickens at constant loudness; movement adds slow shimmer; bass sweep doesn't pump the limiter; the Intimate template's peak (20–30 min) is audibly richer/fuller than its opening; pad chopped by deep pulses still sounds intentional (if not, re-route harmony post-pulse like ambience — one line in engine.create)

## Phase 6 — Polish: robustness, accessibility, history

- [x] Engine start failures surfaced to the user (setup + lab) instead of an unhandled rejection — `src/App.tsx` `begin()`, `src/ui/lab/LabScreen.tsx`, `START_ERROR_MESSAGE` in `src/ui/SafetyNotices.tsx`
- [x] Mono-switch timer cleared on `AudioEngine.dispose()` — `src/audio/engine.ts`
- [x] Keyboard focus styles (`:focus-visible`), safe-area insets for notched phones, `prefers-reduced-motion` — `src/index.css`
- [x] Accessible modals: `role="dialog"`, focus trap, Escape, focus restore — `src/ui/useDialog.ts`, `DisclaimerModal`, `MorningPromptModal`
- [x] `aria-valuetext` on every slider (depth slider speaks the state's labels), live region on the mid-session check-in — `src/ui/Slider.tsx`, `SetupScreen.tsx`, `MicroPrompt.tsx`
- [x] localStorage write failures reported to the UI (warning + export nudge) — `onStorageFailure` in `src/storage/storage.ts`
- [x] ESLint + GitHub Actions CI (lint, test, build); `*.tsbuildinfo` ignored — `eslint.config.js`, `.github/workflows/ci.yml`
- [x] Breathing pacer on the session screen for breathing-rate pulses (calm) — `src/ui/BreathingPacer.tsx`, `src/ui/breathing.ts`
- [x] Session history screen: weekly stats + streak, per-session badges, one-tap replay of the exact profile (`SessionRecord.replayOfSessionId`) — `src/ui/HistoryScreen.tsx`, `src/personalization/history.ts`
- [ ] Verify by ear / in-browser: Begin with site sound blocked shows the notice; calm pacer keeps time with the pulse; replayed session sounds identical to the original

## Phase 7 — Breathing, wake-up, intervals, sharing + hardening

- [x] Hardening: two-step import with confirmation + try/catch + programs count + live region (`src/ui/DataPanel.tsx`); offline export engines disposed per chunk and abort listener always removed (`src/export/offlineRenderer.ts`); render-phase ref/side-effect fixes (`src/app/useStableCallback.ts`, `App.tsx`, `useStoredData.ts`); `React.lazy` for lab/editor/history/insights; radio-group state cards + duration chips (`src/ui/useRadioGroup.ts`), `aria-pressed`/`aria-expanded`/progressbar/status regions, focus to the heading on screen change; memoized program readout + `memo(AdvancedPanel)`; second-tab warning (`src/platform/tabGuard.ts`)
- [x] Guided breathing: box / 4-7-8 / coherent patterns (`src/audio/breathing.ts`), breath mode in `PulseModulator`, `AudioEngine.setBreathPattern` side channel, pattern-driven pacer with phase countdown, per-user `Settings.breathingPattern`, exported into MP3s
- [x] "End at HH:MM" duration mode (`src/session/wallClock.ts`, `DurationPicker`) resolved at Begin
- [x] Wake-up ending for sleep: `withWakeUp`/`resolveArc` arc variant, 3 s fade + chime (`src/session/endPolicy.ts`), `Settings.wakeUp`, rating screen instead of the morning prompt, export mirror
- [x] Interval (Pomodoro) sessions: `src/programs/intervals.ts` → generated Program, `Program.boundaryChime` + `AudioEngine.playCue()` cues in the controller, lab runner and export timeline; `SessionRecord.intervals`; editor checkbox
- [x] Shareable links: `src/share/shareLink.ts` (deflate + base64url in `#share=`), import modal on open, Share buttons on programs / presets / editor
- [ ] Verify by ear: calm + box breathing — circle and swell agree, holds are plateaus, no clicks; sleep 10 min with a 3-min wake-up rises then chimes; focus intervals 2/1 ×2 chime at each switch and end after the last block; a 20-min interval export contains the cues; a shared link imports in a private window

## Ongoing / Cross-cutting

- [x] Session evolution: parameter arcs over the session, crossfaded (§12, §7) — `src/session/evolution.ts`, `AudioEngine.setArcModulation` (arc composed below the profile, so presets/bandit/user-edit detection never see it); always on, per-state arcs
- [x] Synthesized ambience: rain, ocean, wind, space from shaped noise (§6E) — `src/audio/ambience-processor.ts`, `src/audio/layers/ambienceLayer.ts`; post-pulse tap into `master` (pulses never chop weather); per-state §8 defaults; `ambience-up`/`ambience-off` bandit arms (CANDIDATE_SET_VERSION → 2)
- [x] Forest, fireplace, café ambience (§6E) — synthesized in the worklet (leaves + bird motifs, flickering bed + crackles/pops, wandering murmur + clinks), always available; a recording dropped into `public/ambience/` replaces the synthesized version via the existing loader + seamless loop crossfade (`src/audio/ambienceAssets.ts`). Node-side generator test: `src/audio/ambience-processor.test.ts`
- [x] Tone softening: detuning, harmonic stacking, low-pass filtering (§7) — `tone.warmth` (0..1) in `SoundProfile`, implemented in `src/audio/layers/toneLayer.ts` (equal-power, warmth 0 = old pure sine); Warmth slider in the advanced panel
- [ ] Verify by ear: each synth ambience type solo + click-free switches, ambience steady under deep isochronic depth (post-pulse routing), warmth 0→1 sweep on meditation (no loudness jump), 5-min session per state to hear the compressed arc land in the end fade, drop a test `forest.mp3` in `public/ambience/` and hear it loop seamlessly
- [x] MP3 session export ("Download") — offline render of the selected session (profile + arc/program, adaptation excluded by design) via `OfflineAudioContext` suspend-checkpoints driving the ordinary `AudioEngine`, lamejs worker encode — `src/export/`, buttons on the setup screen, program editor and lab (`src/export/useMp3Export.ts`, `src/ui/ExportRow.tsx`)
- [x] Long exports (up to 4 h): 15-min chunked rendering (`splitRenderPlan`) streamed into one encoder session (`Mp3Stream`), equal-power seam crossfade (`src/export/crossfade.ts`), exact rhythm-pattern handover across chunks (`PulseModulator.exportHandover/importHandover`). Known seam artifact: free-running oscillators restart at phase 0 — masked by the crossfade. Follow-up: carry oscillator phase via `OscillatorNode.start()` offsets if a bare pure tone ever exposes it
- [ ] Verify by ear: chunk seams at 15:00 / 30:00 in a long sleep-program export
- [x] PWA: manifest + precached app shell (`vite-plugin-pwa`, `npm run icons` regenerates icons from `public/icon.svg`); Screen Wake Lock, Media Session lock-screen transport, silent keep-alive element, `beforeunload` guard — `src/platform/`
- [ ] Native wrapper for guaranteed background audio on iOS (§7) — the keep-alive element makes it best-effort only -- ignore for now
- [ ] Offline support (§7) -- ignore for now
- [ ] Success-metrics instrumentation: completion, retention, rating trend (§18) -- ignore for now
- [ ] Free/premium gating — unlimited free sessions, gate the intelligence (§19) -- ignore for now
