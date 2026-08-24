# Sample-based ambience assets (PRD §6E)

Drop looped recordings here to activate the sample-based ambience types.
Nothing else is needed — on the next load the app probes this folder and the
matching options appear in the Ambience picker. Types with no file are hidden.

## Expected files

| Type      | File name (either extension)     |
| --------- | -------------------------------- |
| Forest    | `forest.mp3` or `forest.ogg`     |
| Fireplace | `fireplace.mp3` or `fireplace.ogg` |
| Café      | `cafe.mp3` or `cafe.ogg`         |

`.mp3` is probed first, then `.ogg`.

## Source guidance

- **Length:** 30 s – 3 min. The app renders a 1.5 s equal-power crossfade of
  the head into the tail at load time, so the loop seam is handled for you —
  but material with a steady texture (no one-off events near the ends) loops
  best.
- **Loudness:** normalize to roughly −20 LUFS / peaks below −6 dBFS. The
  engine applies its own per-type trim and the master limiter, but wildly hot
  files will pump the limiter.
- **Channels:** stereo preferred (mono works; it will just sound narrower).
- **License:** only bundle recordings you have the rights to ship (CC0 /
  public domain recommended).
