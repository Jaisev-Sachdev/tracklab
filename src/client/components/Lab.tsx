"use client";

import { objectColor } from "@meta-sam/graphics";
import { frameIndexOf, type VideoSegmentationResult, type VideoSegmentationSnapshot } from "@meta-sam/parser";
import type { MediaPlayerLoadedMetadata, VideoRef } from "@meta-sam/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { calibrationFromLine } from "@/domain/physics/calibration";
import { analyseCollision, type CollisionResult } from "@/domain/physics/collision";
import { analysePendulum, type PendulumResult } from "@/domain/physics/pendulum";
import { coverage, tracksFromRecords, type Track } from "@/domain/track/track";
import type { SamPrompt, SampleInfo, VideoSource } from "@/shared/api";
import { runAgent, type AgentEvent } from "../agent/runner";
import { nearestFrame } from "../agent/frames";
import { makeTools, type Answer, type LabContext, type Question } from "../agent/tools";
import { agentStep, trackVideo, uploadVideo } from "../api";
import { getDemoCode, setDemoCode, subscribeDemoCode } from "../demo-code";
import { AgentPanel } from "./AgentPanel";
import { CollisionResults, PendulumResults } from "./Results";
import { VideoStage, type ClickMode, type Line, type Point } from "./VideoStage";

type Loaded = {
  source: VideoSource;
  src: string | Blob;
  label: string;
  note: string;
  credit?: string;
  creditUrl?: string;
};
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
  const [frame, setFrame] = useState<{ index: number; time: number }>();
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
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [agentRunning, setAgentRunning] = useState(false);
  const [question, setQuestion] = useState<Question>();
  const [usage, setUsage] = useState({ inputTokens: 0, outputTokens: 0, samFrames: 0, samImages: 0 });
  // Bumped on every video change, so per-video UI (the agent note, a half-drawn line) starts fresh.
  const [loadKey, setLoadKey] = useState(0);
  // Bumped on every click-mode change, so a half-drawn scale line never completes later.
  const [clickSession, setClickSession] = useState(0);
  const trackRun = useRef(0);
  const agentAbort = useRef<AbortController | null>(null);
  const answerRef = useRef<((a: Answer) => void) | null>(null);

  // The agent's tools run across many renders and network calls; they read the newest state from here.
  const live = useRef({ meta, tracks, pivot, line, refLength, loaded });
  useEffect(() => {
    live.current = { meta, tracks, pivot, line, refLength, loaded };
  });

  function reset(next: Loaded) {
    abort.current?.abort();
    agentAbort.current?.abort();
    setAgentEvents([]);
    setUsage({ inputTokens: 0, outputTokens: 0, samFrames: 0, samImages: 0 });
    setLoadKey((k) => k + 1);
    setLoaded(next);
    setMeta(undefined);
    setSeg(undefined);
    setTracks([]);
    setPivot(undefined);
    setLine(undefined);
    setAnalysis(undefined);
    setError(undefined);
    changeMode("none");
  }

  function changeMode(next: ClickMode) {
    setMode(next);
    setClickSession((n) => n + 1);
  }

  function pickSample(s: SampleInfo) {
    reset({
      source: { kind: "sample", id: s.id },
      src: new URL(s.video, location.href).toString(),
      label: s.title,
      note: s.description,
      credit: s.credit,
      creditUrl: s.creditUrl,
    });
    setPhrase(s.cachedPrompts[0] ?? "");
    setExperiment(s.id.startsWith("collision") ? "collision" : "pendulum");
  }

  async function pickFile(file: File) {
    setError(undefined);
    try {
      setUpload(0);
      const url = await uploadVideo(file, setUpload);
      // Play the local file (instant, no CORS); SAM reads the uploaded copy.
      reset({ source: { kind: "blob", url }, src: file, label: file.name, note: "" });
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

  /** Track with SAM through the whole video; shared by the Track button and the agent. Throws on failure. */
  async function track(prompt: SamPrompt, signal: AbortSignal): Promise<Track[]> {
    const { loaded: current, meta: m } = live.current;
    if (!current || !m) throw new Error("The video hasn't loaded yet.");
    const run = ++trackRun.current;
    const isCurrent = () => run === trackRun.current;
    setAnalysis(undefined);
    setTracks([]);
    live.current.tracks = [];
    setTracking({ frames: 0 });
    // Saved sample output replays free; live calls bill per frame (minimum 50), even if they then fail.
    const src = current.source;
    const sample = src.kind === "sample" ? samples.find((x) => x.id === src.id) : undefined;
    const replayed = prompt.kind === "concept" && sample?.cachedPrompts.includes(prompt.phrase.trim().toLowerCase());
    if (!replayed) setUsage((u) => ({ ...u, samFrames: u.samFrames + Math.max(50, m.numFrames) }));
    try {
      const result = await trackVideo(current.source, prompt, {
        signal,
        onSnapshot: (snap) => {
          if (!isCurrent()) return;
          setSeg(snap);
          setTracking({ frames: new Set(snap.records.map(frameIndexOf)).size });
        },
      });
      if (!isCurrent()) throw new Error("A newer tracking run replaced this one.");
      setSeg(result);
      const found = tracksFromRecords(result.records, { frameTimes: m.frameTimes, width: m.width, height: m.height });
      live.current.tracks = found;
      setTracks(found);
      setObjectA(found[0]?.objectId ?? "");
      setObjectB(found[1]?.objectId ?? "");
      return found;
    } finally {
      if (isCurrent()) setTracking(undefined);
    }
  }

  async function runTracking() {
    if (!phrase.trim()) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(undefined);
    try {
      const found = await track({ kind: "concept", phrase: phrase.trim() }, ctrl.signal);
      if (found.length === 0) setError(`SAM found no "${phrase.trim()}" in the video. Try another short phrase.`);
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    }
  }

  function placePivot(p: Point) {
    live.current.pivot = p;
    setPivot(p);
    setAnalysis(undefined);
  }

  function placeLine(l: Line, lengthM?: number) {
    live.current.line = l;
    setLine(l);
    setAnalysis(undefined);
    if (lengthM !== undefined) {
      live.current.refLength = String(lengthM);
      setRefLength(String(lengthM));
    }
  }

  function calibrationNow() {
    const L = num(live.current.refLength);
    const l = live.current.line;
    if (!l || !L || !(L > 0)) return undefined;
    try {
      return calibrationFromLine({ x1: l.a.x, y1: l.a.y, x2: l.b.x, y2: l.b.y }, L);
    } catch {
      return undefined;
    }
  }

  async function startAgent(note: string) {
    const { loaded: current, meta: m } = live.current;
    if (!current || !m) return;
    agentAbort.current?.abort();
    const ctrl = new AbortController();
    agentAbort.current = ctrl;
    const isCurrent = () => agentAbort.current === ctrl;
    setAgentEvents([]);
    setAgentRunning(true);
    setError(undefined);

    const ctx: LabContext = {
      meta: () => live.current.meta,
      seekToFrame: async (f) => {
        if (!isCurrent()) throw new Error("Stopped.");
        await videoRef.current?.seekToFrame(f);
      },
      captureRawFrame: () => {
        const v = videoRef.current;
        if (!v) throw new Error("The video player isn't ready.");
        return v.captureFrame("raw");
      },
      tracks: () => live.current.tracks,
      pivot: () => live.current.pivot,
      line: () => live.current.line,
      calibration: calibrationNow,
      runTracking: track,
      setPivot: placePivot,
      setCalibration: (l, lengthM) => placeLine(l, lengthM),
      ask: (q, signal) =>
        new Promise<Answer>((resolve, reject) => {
          if (signal.aborted) return reject(new Error("Stopped."));
          setQuestion(q);
          const times = live.current.meta?.frameTimes;
          if (q.timeS !== undefined && times) void videoRef.current?.seekToFrame(nearestFrame(times, q.timeS));
          if (q.answerType === "click_point") changeMode("pivot");
          if (q.answerType === "click_line") changeMode("line");
          const finish = () => {
            answerRef.current = null;
            signal.removeEventListener("abort", onAbort);
            setQuestion(undefined);
            changeMode("none");
          };
          const onAbort = () => {
            finish();
            reject(new Error("Stopped."));
          };
          answerRef.current = (a) => {
            finish();
            resolve(a);
          };
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      countImageCall: () => setUsage((u) => ({ ...u, samImages: u.samImages + 1 })),
      showPendulum: (r) => {
        setExperiment("pendulum");
        setAnalysis({ kind: "pendulum", r });
      },
      showCollision: (r) => {
        setExperiment("collision");
        setAnalysis({ kind: "collision", r });
      },
    };

    const duration = m.frameTimes.at(-1) ?? 0;
    const start =
      `Video "${current.label}": ${m.width}×${m.height} px, ${m.numFrames} frames, ${duration.toFixed(2)} s, ` +
      `about ${m.fps.toFixed(1)} fps.\n` +
      (note.trim() ? `Notes from the person: ${note.trim()}` : "The person gave no notes.");

    try {
      await runAgent({
        start,
        step: (input, signal) => agentStep(input, signal),
        tools: makeTools(ctx),
        signal: ctrl.signal,
        onEvent: (e) => {
          if (!isCurrent()) return;
          if (e.kind === "usage") {
            setUsage((u) => ({
              ...u,
              inputTokens: u.inputTokens + e.inputTokens,
              outputTokens: u.outputTokens + e.outputTokens,
            }));
          } else {
            setAgentEvents((list) => [...list, e]);
          }
        },
      });
    } catch (e) {
      if (!ctrl.signal.aborted && isCurrent()) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isCurrent()) setAgentRunning(false);
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
              if (answerRef.current) answerRef.current({ kind: "point", p });
              else placePivot(p);
              changeMode("none");
            }}
            onLine={(l) => {
              if (answerRef.current) answerRef.current({ kind: "line", line: l });
              else placeLine(l);
              changeMode("none");
            }}
            clickSession={clickSession}
            onLoadedMetadata={onMeta}
            onFrame={(index, time) => setFrame({ index, time })}
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
              {frame && (
                <span className="frame-readout" data-frame={frame.index}>
                  {" "}
                  · frame {frame.index}, {frame.time.toFixed(3)} s
                </span>
              )}
            </span>
          </div>
          {loaded.credit && (
            <p className="muted credit">
              {loaded.creditUrl ? <a href={loaded.creditUrl}>{loaded.credit}</a> : loaded.credit}
            </p>
          )}
        </section>
      )}

      <AgentPanel
        key={loadKey}
        ready={Boolean(loaded && meta)}
        running={agentRunning}
        events={agentEvents}
        question={question}
        defaultNote={loaded?.note ?? ""}
        usage={usage}
        onStart={(note) => void startAgent(note)}
        onStop={() => agentAbort.current?.abort()}
        onAnswer={(text) => {
          const nums = text.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
          // Keyboard alternative to clicking: "x, y" for a point, "x1, y1, x2, y2" for a line.
          if (question?.answerType === "click_point" && nums.length === 2) {
            answerRef.current?.({ kind: "point", p: { x: nums[0]!, y: nums[1]! } });
          } else if (question?.answerType === "click_line" && nums.length === 4) {
            answerRef.current?.({
              kind: "line",
              line: { a: { x: nums[0]!, y: nums[1]! }, b: { x: nums[2]!, y: nums[3]! } },
            });
          } else answerRef.current?.({ kind: "text", text });
        }}
      />

      {loaded && (
        <section className="panel">
          <h2>
            2. Track <small>(or do it by hand)</small>
          </h2>
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
            <button type="submit" disabled={!meta || !phrase.trim() || tracking !== undefined || agentRunning}>
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
                    onClick={() => changeMode(mode === "pivot" ? "none" : "pivot")}
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
                onClick={() => changeMode(mode === "line" ? "none" : "line")}
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
              <input
                inputMode="decimal"
                value={refLength}
                onChange={(e) => {
                  setRefLength(e.target.value);
                  setAnalysis(undefined);
                }}
              />
            </label>
          </div>
          <button type="button" className="primary" onClick={analyse} disabled={agentRunning}>
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
