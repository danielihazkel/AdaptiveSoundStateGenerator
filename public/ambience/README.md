# Optional recorded ambience (PRD §6E)

Forest, fireplace and café are synthesized in the audio worklet and always
available. Drop a looped recording here to *replace* the synthesized version:
nothing else is needed — on the next load the app finds the file and the
ambience layer crossfades from synthesis to the recording once it has decoded.
Types with no file simply keep their synthesized sound.

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
