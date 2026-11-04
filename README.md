# Tracklab

**Film a physics experiment. Meta's SAM 3.1 tracks it frame by frame, and a Muse Spark lab partner measures it,
checks its own work, and tells you what to fix next time.**

Built for the Meta Global AI Developer Hackathon (Indie track, "Push the Frontier").

A school pendulum or a collision of two carts is usually timed with a stopwatch and eyeballed against a ruler.
Tracklab turns a phone video into a measurement with honest error bars:

1. **SAM 3.1** segments the moving objects in every frame (masks, stable ids, through collisions).
2. **Physics fits** written for this project (no fitting library) turn tracks into numbers: a damped-pendulum fit with
   the finite-amplitude correction, or before/after velocity fits around an automatically found moment of contact.
3. **A Muse Spark agent** runs the whole lab: it looks at frames, chooses what to track, recovers when tracking fails
   (other phrases, a still-frame search, or one click from you), finds the pivot and a reference for scale, asks for
   masses or lengths only when it must, fits, and writes a report. Every number in the report must come from a tool;
   any number that doesn't is flagged under the report.

## Does it work?

### Accuracy benchmark ([docs/accuracy.md](docs/accuracy.md))

Ten simulated experiments composited onto real classroom footage, so the true values are known exactly. Pendulum
motion is integrated numerically from the full nonlinear, damped equation (not from the formulas the analysis uses),
rendered with motion blur, camera noise and H.264 compression, then tracked live by SAM 3.1.

| Experiment                                                   | Result vs truth                                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 6 pendulums (L 0.35–0.8 m, 6–20° swings, damping, 25–60 fps) | g within **0.02 %** with a tape-measured length; within **0.17 %** from video alone |
| 4 collisions (mass ratios 1:3 to 2:1, restitution 0–1)       | momentum ratio and restitution within **1.6 σ**; contact time within 4 ms           |

### Real footage: a classroom pendulum

A 0.5 m classroom pendulum from Wikimedia Commons (credit below). SAM can't find its small dark bob from a phrase, so
the lab partner asks for one click, tracks it through 319 of 326 frames, and measures **g = 9.48 ± 0.04 m/s²**, which
is 3.5 % low. It then explains why, from numbers our code computed: 9.81 would need a length of 0.517 m, 1.7 cm longer
than stated and about the size of the bob, so the 0.5 m was most likely measured to the knot rather than the bob's
centre. Its suggestion for the next trial: measure the length from the pivot to the bob's centre.

## How it's built

```
browser                                            server (Next.js route handlers, Vercel)
───────                                            ──────────────────────────────────────
Meta's frame-exact player (@meta-sam/react)        /api/sam/track   → SAM 3.1 video, streamed (SSE)
SAM output → tracks (@meta-sam/parser)             /api/sam/image   → SAM 3.1 on one still frame
physics fits (src/domain, pure TS)                 /api/agent/step  → one Muse Spark 1.3 step; the server fixes
agent loop + tools (src/client/agent)                                  the model, instructions and tools
                                                   /api/upload      → Vercel Blob upload token
```

- `src/domain/` — pure TypeScript: tracks from SAM records, least squares (Levenberg–Marquardt, circle and line fits
  with standard errors), pendulum and collision analysis, calibration. Tested against a numerically integrated
  pendulum and against SAM's real output on test clips.
- `src/client/agent/` — the lab-partner loop (`runner.ts`) and its tools (`tools.ts`). The prompt and tool definitions
  are data: `content/agent/instructions.md`, `content/agent/tools.json`.
- `src/server/` — the Meta Model API client, demo-code gate, request validation, sample registry.
- `DECISIONS.md` — every trade-off and finding, including two independent code reviews and what they caught.

Costs are small: SAM 3.1 video is $0.20 per 1,000 frames; a full lab-partner run is about $0.05–0.25.

## Run it

```sh
npm install
cp .env.example .env.local   # add MODEL_API_KEY from dev.meta.ai
npm run dev                  # http://localhost:3000
npm run check                # typecheck, lint, format, 74 tests
```

Live calls (SAM, Muse Spark, uploads) need a demo code in production (`DEMO_CODES`); without one, the bundled samples
replay saved SAM output and recorded lab-partner runs. Other settings: `BLOB_PUBLIC_HOST`, `BLOB_READ_WRITE_TOKEN`,
`MAX_VIDEO_SECONDS`, `SPARK_MODEL` (see `src/server/env.ts`).

Reproduce the benchmark (renders from the Commons footage, then about $0.70 of SAM calls):

```sh
npm run bench:render && npm run bench:run
```

## Credits and licences

- Tracklab's code: MIT (see `LICENSE`).
- `@meta-sam/*` packages: Meta's SAM License; used as dependencies, not vendored.
- `public/samples/pendulum-classroom.mp4`: excerpt of
  ["Pendelgesetz (mit Rechnung)"](<https://commons.wikimedia.org/wiki/File:Pendelgesetz_(mit_Rechnung).webm>) by
  Mathe-AC Lernwerkstatt Aachen (Rhetos), Wikimedia Commons, CC BY-SA 4.0; trimmed and re-encoded, and shared under
  the same licence.
- Benchmark backgrounds: the same source and
  ["Fadenpendelgeschwindigkeit (2 grad)"](<https://commons.wikimedia.org/wiki/File:Fadenpendelgeschwindigkeit_(2_grad).webm>),
  also CC BY-SA 4.0.
- The synthetic sample clips are rendered by `scripts/spike/make-clips.ts`.
