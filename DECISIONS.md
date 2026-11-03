# Decisions

Technical trade-offs, newest last. Each entry: context, decision, consequence.

## D-001 Spike before building: go (2026-11-03)

**Context:** The hackathon deadline is 2026-11-05 10:00 SGT. Before building anything we checked that the Meta Model
API works from Singapore and that SAM 3.1 and Muse Spark can do what Tracklab needs. Tests ran on synthetic clips with
known physics (`npm run spike:clips`): a 0.5 m pendulum at 10° (300 frames) and an elastic collision of two equal
balls (120 frames).
**Findings:**

- Account, key and calls work from Singapore (personal account, billing country set to Singapore).
- SAM 3.1 video tracks every frame. Frame indices line up with time (best fit at zero frame shift). Mask-centroid error
  vs truth: median 1.75 px, max 2.9 px, a near-constant offset from the renderer's pixel rounding, so it cancels out
  of periods and velocities.
- In the collision clip, both object ids stayed on their own ball through the contact. Boxes clipped at the frame
  edge drift (max 25 px), so the edge frames must be dropped before fitting.
- Speed: first frame after about 3 s; 300 frames in 10–26 s. Cost $0.20 per 1,000 frames (300 frames = $0.06).
- Text (concept) prompts are unreliable on video: "red ball" found nothing in the pendulum video but found the ball in
  a still frame of it; "circle" found it in the video. "blue ball" worked on the collision video. Box prompts on a
  frame always tracked.
- Muse Spark 1.3 takes images plus function tools and answered with a sensible `track` call in 6–8 s for about
  2–4k tokens. Given the whole video, it misread the pendulum as "two colliding pendulums" (about 3.3k input tokens
  for 10 s, so it samples sparsely).

**Decision:** Go. Build as planned, with the changes in D-002 to D-004.
**Consequence:** The agent's "check tracking and re-prompt" step is required, not decoration.

## D-002 The agent verifies tracking and falls back to box prompts (2026-11-03)

**Context:** D-001 found text prompts sometimes return nothing on video.
**Decision:** The `track` tool reports coverage (frames found / total) and the agent must check it. On empty or partial
tracks it tries other noun phrases, then a box prompt: it finds the object on a still frame with a SAM image call (which
was reliable) or the user clicks it. Box prompts are built with `buildObjectPrompt` from `@meta-sam/parser`.
**Consequence:** One extra SAM image call in the failure path; the user can always rescue a run with one click.

## D-003 The agent sees sampled frames and numbers, not the raw video (2026-11-03)

**Context:** Muse Spark's whole-video reading was coarse and wrong on the test clip; still frames were described
correctly.
**Decision:** `get_frames` returns a few chosen frames with the tracks drawn on; `track` and `fit` return numbers.
The agent never receives the video file.
**Consequence:** Cheaper turns and claims grounded in the tracked data. The agent can't notice things outside the
frames it asks for, so the prompt tells it to sample start, middle and end.

## D-004 Use Meta's official SAM client packages (2026-11-03)

**Context:** Meta publishes `@meta-sam/parser` (stream parsing, mask decoding, object prompts), `@meta-sam/graphics`
(Canvas overlays), `@meta-sam/video` (frame-exact playback, including variable frame rate) and `@meta-sam/react` from
[meta-models/meta-sam](https://github.com/meta-models/meta-sam). The parser decoded every mask in the spike output with
no diagnostics.
**Decision:** Use the parser for all SAM output and try `@meta-sam/video` / `@meta-sam/react` for playback and overlays
before writing our own. Pin exact versions.
**Consequence:** Less code of our own, and the phone-video frame-timing risk is handled by Meta's library. Those
packages are under the SAM License, not MIT; our code stays MIT and depends on them without vendoring them.

## D-005 g needs a marked pivot or a measured length (2026-11-03)

**Context:** The first plan fitted the pivot from the bob's arc. At a 10° swing the arc bows by only about 6 px over
400 px, so 1–2 px of tracking bias moves the centre a lot. On SAM's real output for the synthetic clip, the fitted
length came out 14% long while its error bar claimed about 2%, giving g = 11.17 ± 0.20 instead of 9.81.
**Decision:** The pivot comes from the user (a click) or from SAM on a still frame, and every frame then measures the
length directly. A pivot fitted from the arc is still used for angles, since the period hardly depends on it, but never
for length. Without a marked pivot or a hand-measured length, the analysis gives the period and no g, and says why.
**Consequence:** One more setup step for the user, which the agent can usually do with a SAM image call. On the same
SAM output: period 1.42112 s vs 1.42120 s true; g = 9.787 ± 0.037 with the pivot marked and 9.803 ± 0.020 with a
tape-measured length; collision momentum ratio 0.998 ± 0.013 and restitution 1.001 ± 0.003.

## D-006 Next.js 16.4.4, not 16.4.0 (2026-11-03)

**Context:** `npm audit` flags next 16.0.0–16.4.0 as critical (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr: remote code
execution; GHSA-p3m5-59mp-jv5r: denial of service).
**Decision:** Pin next and eslint-config-next to 16.4.4.
**Consequence:** `npm audit --omit=dev` is clean.
