# Tempo

**Live app: https://lawrencedrums.github.io/tempo/**

A metronome for drummers that runs in the browser and installs as an app (PWA) on Android and macOS. It works offline and keeps all data on the device.

## Features

- Tempo from 20 to 400 BPM: dial, ±1/±5, typed entry, tap tempo
- Time signatures from 1 to 20 beats over 2, 4, 8 or 16, with the BPM counting quarters, dotted quarters or each click
- Subdivisions from 2 to 6 per beat, named for the meter (8ths, triplets, 16ths…), with swing presets and a separate subdivision volume
- Per-beat accents: tap a beat to step through strong, accent, normal and muted
- Tempo trainer, gap click (fixed or random muted bars), count-in and practice timer
- Songs and setlists, with export and import as a JSON file
- Six synthesised click sounds, volume boost, screen flash, audio delay compensation for Bluetooth
- Keyboard: Space start/stop, ↑/↓ tempo (Shift for ±5), T tap, 1–6 subdivision, [ and ] previous/next song, M menu

## Develop

```sh
npm install
npm run dev      # local dev server
npm test         # timing tests
npm run build    # type-check and build to dist/
npm run preview  # serve the build, including the service worker
```

## How it is built

- `src/sequencer.ts` works out when every click falls. It has no browser dependencies and is covered by `src/sequencer.test.ts`.
- `src/engine.ts` schedules those clicks on the Web Audio clock slightly ahead of time, so timing does not depend on JavaScript timers.
- `src/sounds.ts` synthesises the click sounds, so there are no audio files.
- `src/store.ts` validates and saves state in `localStorage`.
- `src/main.ts` is the UI, in plain TypeScript with no framework.
- `vite.config.ts` generates the service worker that caches the build for offline use.

## Deploy

The build is a static site with relative paths, so `dist/` can be served from any host or sub-path. `.github/workflows/deploy.yml` publishes it to GitHub Pages on every push to `main`, once Pages is enabled in the repository settings with "GitHub Actions" as the source.
