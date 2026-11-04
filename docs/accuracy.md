# Accuracy benchmark

Simulated experiments composited onto real classroom footage (Wikimedia Commons, CC BY-SA 4.0), so the true values
are known exactly. Pendulum motion is integrated numerically from the full nonlinear, damped equation of motion;
everything is rendered at 4× the frame rate and averaged (motion blur), then sensor noise and H.264 compression are
added. SAM 3.1 tracks each clip live from a box on the first frame; Tracklab's analysis runs exactly as in the app.
Regenerate with `npm run bench:render && npm run bench:run`.

## Pendulums (true g = 9.81 m/s²)

| Clip             | Setup                                   | Frames tracked | g, tape-measured length | vs truth      | g, video only (pivot + 0.5 m bar) | vs truth      |
| ---------------- | --------------------------------------- | -------------- | ----------------------- | ------------- | --------------------------------- | ------------- |
| bench-pendulum-1 | L = 0.35 m, 8°, damping 0/s, 30 fps     | 360/360        | 9.808 ± 0.056 m/s²      | −0.02%, −0.0σ | 9.804 ± 0.087 m/s²                | −0.06%, −0.1σ |
| bench-pendulum-2 | L = 0.5 m, 12°, damping 0.02/s, 30 fps  | 360/360        | 9.811 ± 0.039 m/s²      | +0.01%, +0.0σ | 9.793 ± 0.075 m/s²                | −0.17%, −0.2σ |
| bench-pendulum-3 | L = 0.65 m, 6°, damping 0.04/s, 60 fps  | 720/720        | 9.812 ± 0.030 m/s²      | +0.02%, +0.1σ | 9.811 ± 0.070 m/s²                | +0.01%, +0.0σ |
| bench-pendulum-4 | L = 0.8 m, 15°, damping 0.01/s, 30 fps  | 360/360        | 9.809 ± 0.025 m/s²      | −0.01%, −0.0σ | 9.805 ± 0.068 m/s²                | −0.05%, −0.1σ |
| bench-pendulum-5 | L = 0.45 m, 20°, damping 0.03/s, 60 fps | 720/720        | 9.808 ± 0.044 m/s²      | −0.02%, −0.0σ | 9.804 ± 0.078 m/s²                | −0.07%, −0.1σ |
| bench-pendulum-6 | L = 0.7 m, 10°, damping 0/s, 25 fps     | 300/300        | 9.809 ± 0.028 m/s²      | −0.01%, −0.0σ | 9.803 ± 0.069 m/s²                | −0.08%, −0.1σ |

## Collisions (true momentum ratio = 1)

| Clip              | Setup                       | Frames tracked   | Momentum after ÷ before | vs truth | Restitution                | vs truth | Contact time error |
| ----------------- | --------------------------- | ---------------- | ----------------------- | -------- | -------------------------- | -------- | ------------------ |
| bench-collision-1 | masses 1:1, e = 1, 30 fps   | 120/120, 120/120 | 0.987 ± 0.017           | −0.7σ    | 0.9985 ± 0.0032 (true 1)   | −0.5σ    | 3 ms               |
| bench-collision-2 | masses 2:1, e = 0.6, 60 fps | 240/240, 240/240 | 0.9980 ± 0.0018         | −1.1σ    | 0.5972 ± 0.0017 (true 0.6) | −1.6σ    | -1 ms              |
| bench-collision-3 | masses 1:3, e = 0.3, 30 fps | 120/120, 120/120 | 1.008 ± 0.016           | +0.5σ    | 0.2991 ± 0.0019 (true 0.3) | −0.5σ    | 4 ms               |
| bench-collision-4 | masses 1.5:1, e = 0, 60 fps | 240/240, 240/240 | 0.9949 ± 0.0044         | −1.2σ    | 0.0018 ± 0.0018 (true 0)   | +1.0σ    | 3 ms               |
