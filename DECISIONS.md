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

## D-007 Live calls need a demo code; bundled samples replay for free (2026-11-03)

**Context:** The app will be public for judging. Every live call (SAM, Muse Spark, uploads) is billed to one personal
account, and an open agent route would be a free model proxy.
**Decision:** Live routes require a code from `DEMO_CODES` in the `x-demo-code` header (constant-time compare). With no
codes configured, development is open and production is closed. Saved SAM output for the bundled samples replays
through the same streaming route without a code (`npm run cache:sample`). Uploads go browser → Vercel Blob directly
with a token issued only for a code, MP4/MOV only, 150 MB max, and SAM only accepts our Blob store's URLs.
**Consequence:** Judges get the code in the submission form; anyone else can still watch the samples. Meta's spend
alert stays the backstop. No per-code rate limit yet.

## D-008 The browser runs the agent loop; the server fixes the model, instructions and tools (2026-11-03)

**Context:** The tools need the video, the tracks and the user (clicks, measured lengths), which all live in the
browser. Serverless functions shouldn't hold a long agent loop.
**Decision:** `/api/agent/step` runs one stateless Muse Spark call (`store: false`) on the conversation the browser
sends. The server adds the model, `content/agent/instructions.md` and `content/agent/tools.json`, and rejects system
or developer messages and more than 24 images. Frames go at 640 px wide to stay under Vercel's 4.5 MB body limit.
**Consequence:** Each step is short (about 3 s in the smoke test). The conversation is resent each step, so long runs
cost more input tokens; capped by 14 tool calls in the instructions and 160 items in the schema.

## D-009 Fixes from an independent review of steps 1 and 2 (2026-11-03)

**Context:** Two reviewers read the physics core and the server separately, without our conclusions, and reproduced
their findings with probes.
**Decision:** Fixed:

- Collision contact time is now the breakpoint where two straight lines (before/after) beat one, across both objects.
  "First frame near closest approach" was early on slow approaches (restitution 0.909 instead of 1, no warning).
- Momentum ratio and restitution are computed in pixels, where the length scale cancels; its error now only enters
  absolute values, as one correlated term. Before, it roughly doubled the ratios' error bars.
- An id swap at contact is detected from path continuity and undone, with a warning, instead of reporting restitution
  −1. Negative restitution, a near-zero approach speed and "nothing changed speed" now warn or refuse.
- Energy ratio has an uncertainty; ratios no longer give NaN when the numerator is zero.
- The pendulum is now also tested against a numerically integrated nonlinear, damped pendulum (RK4) rather than only
  against the series formula it inverts: g within 0.3% at 5° and 15°, with and without damping.
- Singular-matrix detection is relative to the matrix scale; `fitLine` needs 3 points; frame times must increase and
  frames past the end are an error, not silently dropped.
- Agent route: conversation items are allowlisted (user/assistant text, inline JPEG/PNG images, calls to our own tools
  and their outputs); remote image URLs, videos and files are rejected; output is capped at 6,000 tokens per step.
- Uploads: only this project's Blob store (`BLOB_PUBLIC_HOST`) under `uploads/` is tracked, and the server reads the
  video's duration from its container (mediabunny, range requests) and refuses anything over `MAX_VIDEO_SECONDS` (60).
- Object prompts must match `buildObjectPrompt`'s grammar. Request bodies are capped while streaming. The upload route
  only issues tokens, with fixed error text. `readSse` cancels the stream if the consumer stops early. Preview
  deployments send sample videos inline (deployment protection would block Meta's fetch).
- A nested zod 4.1.11 under `@vercel/blob` (advisory GHSA-mrhx-c7xc-m3w5) is overridden to 4.6.6.

**Consequence:** 54 tests. Still open, by choice: no per-code rate limit (use long random demo codes, rotate them,
and keep Meta's spend alert); the UI must convert pivot clicks to continuous pixel coordinates (pixel i's centre is
i + 0.5), not the parser README's floored indices, or g picks up about +0.1% bias.

## D-010 The lab partner loop, and what live runs taught it (2026-11-03)

**Context:** Step 4 wires Muse Spark 1.3 to the tools in the browser. Live runs on the synthetic samples drove changes.
**Decision:**

- `runAgent` keeps the conversation, sends one step at a time, runs the called tool, and returns tool images in a user
  message right after the tool output (portable across Responses-compatible APIs). Reasoning items aren't resent.
  Tool errors go back to the model as text. Budgets: 16 tool calls, then "finish now", then stop; two nudges if it
  answers without a tool; at most 20 images kept (oldest replaced by a note).
- Frames for the model are the decoded frame at source resolution, annotated in source pixels (ids, pivot, scale
  line), sent at 640 px wide; `locate` sends up to 1920 px for small things like a clamp and scales boxes back.
- The tools read the newest page state through a ref mirror, since the loop outlives renders.
- `analyse_pendulum` reports an uncertainty budget (shares of var(g)). In the first live run the agent advised
  "film longer" when the scale line, not the period, limited g; with the budget and an instruction to target its
  largest share, it advised measuring the length to ±1 mm instead. It now also uses a length the person states.

**Consequence:** Live results: pendulum g = 9.799 ± 0.067 (scale line) and 9.811 ± 0.039 (stated length), about
$0.12–0.21 a run; collision momentum ratio 0.997 ± 0.012 after asking for the masses, about $0.05. In both pendulum
runs "red ball" found nothing on video and the agent recovered (another phrase, or `locate` + `track_boxes`).

## D-011 Fixes from an independent review of steps 3 and 4 (2026-11-04)

**Context:** A reviewer read the browser code (agent loop, tools, page state) without our conclusions.
**Decision:** Fixed:

- The model's `finish` arguments are validated (`parseReport`) before the UI sees them; an incomplete report goes back
  to the model instead of crashing the page. Decimal numbers in the headline or comparison that appear in no tool
  result or note are listed under the report as not measured (`unverifiedNumbers`).
- An invented tool name no longer enters the conversation (the server would 400 on it); the model is told which tools
  exist. The budget now runs exactly `maxToolCalls` tools; stopping mid-step ends cleanly.
- Only the newest tracking run commits tracks; manual Track and Analyse are disabled while the agent runs; a stale agent
  run (after Stop or a video change) can't seek, capture or log. Results clear when the pivot or scale changes.
- A half-drawn scale line is tied to one click session and never completes later. The agent note resets per video.
- `analyse_collision` refuses the same object twice; the stated length's error can't be set below 1 mm; frames for
  the model fit 640×640 and images are also pruned by total size, so portrait video can't break the 4.5 MB limit; the
  `get_frames` description says image coordinates are scaled.
- `ask` cleans up its abort listener, seeks to the nearest frame, and clicks can be typed as coordinates (keyboard
  access). The timeline and questions are live regions. Cost counts SAM still-frame calls and failed live tracks.

**Consequence:** 74 tests. Still open: no `error.tsx` boundary; tests don't exercise `track_boxes` rounding or
`locate` scaling directly (both were checked by the reviewer).

## D-012 Real footage and an accuracy benchmark, without filming (2026-11-04)

**Context:** We can't film our own experiments. We need real footage for credibility and known truth for accuracy.
**Decision:**

- Real sample: a 13 s excerpt of "Pendelgesetz (mit Rechnung)" (Mathe-AC Lernwerkstatt Aachen, Wikimedia Commons,
  CC BY-SA 4.0), a 0.5 m classroom pendulum, credited in the UI. SAM can't find its small dark bob from a phrase, but
  tracks it from one box or click in 319–323 of 326 frames. g = 9.48 ± 0.04 m/s², about 3.5% low: the length that
  would give 9.81 is 0.517 m, so the board's 0.5 m is most likely measured to the knot, not the bob's centre. The agent
  reaches that diagnosis itself from `length_that_would_give_9_81_m`, after asking for one click.
- Dropped: Apollo 15's hammer-feather drop (NASA, public domain): in the wide shot the hammer is about 10 px on
  interlaced 1971 video with no reliable scale. A real Commons ball collision: under a second of oblique motion.
- Benchmark (`npm run bench:render && npm run bench:run`, results in `docs/accuracy.md`): 6 pendulums and 4
  collisions composited onto real classroom footage. Pendulum motion is integrated from the nonlinear damped equation
  (not the series formula the analysis inverts), rendered at 4× and averaged for motion blur, with sensor noise and
  H.264 compression. SAM tracks live from a first-frame box. Results: g within 0.02% (tape length) and 0.17% (video
  scale only) on all six; momentum ratio and restitution within 1.6σ on all four, contact within 4 ms. About $0.70.

**Consequence:** The source downloads (`footage-src/`) and rendered clips (`bench-out/`) are git-ignored and
reproducible from the scripts. The agent's instructions now cap phrase guessing (two `track`, one `locate`) before
asking for a click, and explain the stated-length pitfall.
