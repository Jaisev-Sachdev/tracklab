"use client";

import { objectColor } from "@meta-sam/graphics";
import { frameIndexOf, type VideoSegmentationResult, type VideoSegmentationSnapshot } from "@meta-sam/parser";
import type { MediaPlayerLoadedMetadata, VideoRef } from "@meta-sam/react";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { calibrationFromLine } from "@/domain/physics/calibration";
import { analyseCollision, type CollisionResult } from "@/domain/physics/collision";
import { analysePendulum, type PendulumResult } from "@/domain/physics/pendulum";
import { coverage, tracksFromRecords, type Track } from "@/domain/track/track";
import type { SampleInfo, VideoSource } from "@/shared/api";
import { trackVideo, uploadVideo } from "../api";
import { getDemoCode, setDemoCode, subscribeDemoCode } from "../demo-code";
import { CollisionResults, PendulumResults } from "./Results";
import { VideoStage, type ClickMode, type Line, type Point } from "./VideoStage";

type Loaded = { source: VideoSource; src: string | Blob; label: string };
type Meta = { width: number; height: number; numFrames: number; fps: number; frameTimes: number[] };
type Analysis = { kind: "pendulum"; r: PendulumResult } | { kind: "collision"; r: CollisionResult };

const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

export function Lab({ samples }: { samples: SampleInfo[] }) {
  const videoRef = useRef<VideoRef>(null);
  const demoCode = useSyncExternalStore(subscribeDemoCode, getDemoCode, () => "");
  const [loaded, setLoaded] = useState<Loaded>();
  const [meta, setMeta] = useState<Meta>();
  const [phrase, setPhrase] = useState("");
  const [seg, setSeg] = useState<VideoSegmentationSnapshot | VideoSegmentationResult>();
  const [tracking, setTracking] = useState<{ frames: number } | undefined>();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [mode, setMode] = useState<ClickMode>("none");
  const [pivot, setPivot] = useState<Point>();
  const [line, setLine] = useState<Line>();
  const [refLength, setRefLength] = useState("");
  const [measuredLength, setMeasuredLength] = useState("");
  const [experiment, setExperiment] = useState<"pendulum" | "collision">("pendulum");
  const [objectA, setObjectA] = useState("");
  const [objectB, setObjectB] = useState("");
  const [massA, setMassA] = useState("");
  const [massB, setMassB] = useState("");
  const [analysis, setAnalysis] = useState<Analysis>();
  const [error, setError] = useState<string>();
  const [upload, setUpload] = useState<number>();
  const abort = useRef<AbortController | null>(null);

  function reset(next: Loaded) {
    abort.current?.abort();
    setLoaded(next);
    setMeta(undefined);
    setSeg(undefined);
    setTracks([]);
    setPivot(undefined);
    setLine(undefined);
    setAnalysis(undefined);
    setError(undefined);
    setMode("none");
  }

  function pickSample(s: SampleInfo) {
    reset({ source: { kind: "sample", id: s.id }, src: new URL(s.video, location.href).toString(), label: s.title });
    setPhrase(s.cachedPrompts[0] ?? "");
    setExperiment(s.id.startsWith("collision") ? "collision" : "pendulum");
  }

  async function pickFile(file: File) {
    setError(undefined);
    try {
      setUpload(0);
      const url = await uploadVideo(file, setUpload);
      // Play the local file (instant, no CORS); SAM reads the uploaded copy.
      reset({ source: { kind: "blob", url }, src: file, label: file.name });
      setPhrase("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpload(undefined);
    }
  }

  function onMeta(m: MediaPlayerLoadedMetadata) {
    const packets = [...m.videoPackets].sort((a, b) => a.frameIndex - b.frameIndex);
    const first = packets[0]?.timestamp ?? 0;
    setMeta({
      width: m.width,
      height: m.height,
      numFrames: m.numFrames,
      fps: m.fps,
      frameTimes: packets.map((p) => p.timestamp - first),
    });
  }

  async function runTracking() {
    if (!loaded || !meta || !phrase.trim()) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(undefined);
    setAnalysis(undefined);
    setTracks([]);
    setTracking({ frames: 0 });
    try {
      const result = await trackVideo(
        loaded.source,
        { kind: "concept", phrase: phrase.trim() },
        {
          signal: ctrl.signal,
          onSnapshot: (s) => {
            setSeg(s);
            setTracking({ frames: new Set(s.records.map(frameIndexOf)).size });
          },
        },
      );
      setSeg(result);
      const found = tracksFromRecords(result.records, {
        frameTimes: meta.frameTimes,
        width: meta.width,
        height: meta.height,
      });
      setTracks(found);
      setObjectA(found[0]?.objectId ?? "");
      setObjectB(found[1]?.objectId ?? "");
      if (found.length === 0) setError(`SAM found no "${phrase.trim()}" in the video. Try another short phrase.`);
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abort.current === ctrl) setTracking(undefined);
    }
  }

  const calibration = useMemo(() => {
    const L = num(refLength);
    if (!line || !L || !(L > 0)) return undefined;
    try {
      return calibrationFromLine({ x1: line.a.x, y1: line.a.y, x2: line.b.x, y2: line.b.y }, L);
    } catch {
      return undefined;
    }
  }, [line, refLength]);

  function analyse() {
    setError(undefined);
    try {
      const find = (id: string) => tracks.find((t) => t.objectId === id);
      if (experiment === "pendulum") {
        const t = find(objectA);
        if (!t) throw new Error("Pick the tracked bob first.");
        const L = num(measuredLength);
        setAnalysis({
          kind: "pendulum",
          r: analysePendulum(t, {
            pivot,
            calibration,
            measuredLengthM: L && L > 0 ? { value: L, se: 0.002 } : undefined,
          }),
        });
      } else {
        const a = find(objectA);
        const b = find(objectB);
        const ma = num(massA);
        const mb = num(massB);
        if (!a || !b || a === b) throw new Error("Pick two different tracked objects.");
        if (!ma || !mb || ma <= 0 || mb <= 0) throw new Error("Enter both masses.");
        setAnalysis({ kind: "collision", r: analyseCollision(a, b, { massA: ma, massB: mb, calibration }) });
      }
    } catch (e) {
      setAnalysis(undefined);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const overlays = useMemo(
    () => ({
      pivot,
      line,
      trails: tracks.map((t) => ({ id: t.objectId, color: objectColor(t.objectId), points: t.samples })),
    }),
    [pivot, line, tracks],
  );

  const total = meta?.numFrames ?? 0;

  return (
    <div className="lab">
      <section className="panel sources">
        <h2>1. Video</h2>
        <div className="row wrap">
          {samples.map((s) => (
            <button
              key={s.id}
              type="button"
              className={loaded?.source.kind === "sample" && loaded.source.id === s.id ? "chip on" : "chip"}
              onClick={() => pickSample(s)}
              title={s.description}
            >
              {s.title}
            </button>
          ))}
          <label className="chip file">
            {upload === undefined ? "Upload a video…" : `Uploading ${Math.round(upload * 100)}%`}
            <input
              type="file"
              accept="video/mp4,video/quicktime"
              disabled={upload !== undefined}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void pickFile(f);
              }}
            />
          </label>
        </div>
        <label className="field">
          Demo code <small>(needed for uploads and live analysis; samples replay without one)</small>
          <input
            type="password"
            autoComplete="off"
            value={demoCode}
            onChange={(e) => setDemoCode(e.target.value.trim())}
          />
        </label>
      </section>

      {loaded && (
        <section className="panel stage-panel">
          <VideoStage
            src={loaded.src}
            media={meta}
            result={seg}
            overlays={overlays}
            mode={mode}
            onPick={(p) => {
              setPivot(p);
              setMode("none");
            }}
            onLine={(l) => {
              setLine(l);
              setMode("none");
            }}
            onLoadedMetadata={onMeta}
            onError={(e) => setError(e.message)}
            videoRef={videoRef}
          />
          <div className="row">
            <button type="button" onClick={() => void videoRef.current?.play()}>
              Play
            </button>
            <button type="button" onClick={() => videoRef.current?.pause()}>
              Pause
            </button>
            <button type="button" onClick={() => void videoRef.current?.previousFrame()}>
              ◀ Frame
            </button>
            <button type="button" onClick={() => void videoRef.current?.nextFrame()}>
              Frame ▶
            </button>
            <span className="muted">
              {meta ? `${meta.width}×${meta.height}, ${meta.numFrames} frames, ${meta.fps.toFixed(1)} fps` : "Loading…"}
            </span>
          </div>
        </section>
      )}

      {loaded && (
        <section className="panel">
          <h2>2. Track</h2>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void runTracking();
            }}
          >
            <input
              aria-label="What to track"
              placeholder="short noun phrase, e.g. red ball"
              value={phrase}
              maxLength={60}
              onChange={(e) => setPhrase(e.target.value)}
            />
            <button type="submit" disabled={!meta || !phrase.trim() || tracking !== undefined}>
              {tracking ? `Tracking… ${tracking.frames}/${total}` : "Track with SAM 3.1"}
            </button>
          </form>
          {tracks.length > 0 && (
            <table className="coverage">
              <thead>
                <tr>
                  <th>Object</th>
                  <th>Frames</th>
                  <th>Cut off at edge</th>
                  <th>Longest gap</th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((t) => {
                  const c = coverage(t, total);
                  return (
                    <tr key={t.objectId}>
                      <td>
                        <i className="swatch" style={{ background: objectColor(t.objectId) }} /> {t.objectId}
                      </td>
                      <td>
                        {c.framesTracked}/{total} ({Math.round(c.fraction * 100)}%)
                      </td>
                      <td>{c.clippedFrames}</td>
                      <td>{c.longestGap}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tracks.length > 0 && (
        <section className="panel">
          <h2>3. Measure</h2>
          <div className="row">
            <label>
              <input type="radio" checked={experiment === "pendulum"} onChange={() => setExperiment("pendulum")} />{" "}
              Pendulum
            </label>
            <label>
              <input type="radio" checked={experiment === "collision"} onChange={() => setExperiment("collision")} />{" "}
              Collision
            </label>
          </div>
          <div className="grid">
            <label className="field">
              {experiment === "pendulum" ? "Bob" : "Object A"}
              <select value={objectA} onChange={(e) => setObjectA(e.target.value)}>
                {tracks.map((t) => (
                  <option key={t.objectId}>{t.objectId}</option>
                ))}
              </select>
            </label>
            {experiment === "collision" && (
              <>
                <label className="field">
                  Object B
                  <select value={objectB} onChange={(e) => setObjectB(e.target.value)}>
                    {tracks.map((t) => (
                      <option key={t.objectId}>{t.objectId}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Mass A (kg)
                  <input inputMode="decimal" value={massA} onChange={(e) => setMassA(e.target.value)} />
                </label>
                <label className="field">
                  Mass B (kg)
                  <input inputMode="decimal" value={massB} onChange={(e) => setMassB(e.target.value)} />
                </label>
              </>
            )}
            {experiment === "pendulum" && (
              <>
                <div className="field">
                  Pivot
                  <button
                    type="button"
                    className={mode === "pivot" ? "on" : ""}
                    onClick={() => setMode(mode === "pivot" ? "none" : "pivot")}
                  >
                    {mode === "pivot"
                      ? "Click the pivot on the video…"
                      : pivot
                        ? `(${pivot.x.toFixed(1)}, ${pivot.y.toFixed(1)}) · change`
                        : "Mark the pivot"}
                  </button>
                </div>
                <label className="field">
                  Measured length, pivot to bob centre (m) <small>optional, most accurate</small>
                  <input
                    inputMode="decimal"
                    value={measuredLength}
                    onChange={(e) => setMeasuredLength(e.target.value)}
                  />
                </label>
              </>
            )}
            <div className="field">
              Scale <small>a line across something of known length</small>
              <button
                type="button"
                className={mode === "line" ? "on" : ""}
                onClick={() => setMode(mode === "line" ? "none" : "line")}
              >
                {mode === "line"
                  ? "Click both ends…"
                  : line
                    ? `${Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y).toFixed(1)} px · redraw`
                    : "Draw the scale line"}
              </button>
            </div>
            <label className="field">
              Its real length (m)
              <input inputMode="decimal" value={refLength} onChange={(e) => setRefLength(e.target.value)} />
            </label>
          </div>
          <button type="button" className="primary" onClick={analyse}>
            Analyse
          </button>
        </section>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {analysis?.kind === "pendulum" && <PendulumResults r={analysis.r} />}
      {analysis?.kind === "collision" && <CollisionResults r={analysis.r} />}
    </div>
  );
}
