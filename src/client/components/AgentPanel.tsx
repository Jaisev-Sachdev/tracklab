"use client";

import { useState } from "react";
import type { AgentEvent, FinishReport } from "../agent/runner";
import type { Question } from "../agent/tools";

type Props = {
  ready: boolean;
  running: boolean;
  events: AgentEvent[];
  question: Question | undefined;
  defaultNote: string;
  usage: { inputTokens: number; outputTokens: number; samFrames: number; samImages: number };
  onStart: (note: string) => void;
  onStop: () => void;
  onAnswer: (text: string) => void;
  /** A recorded run for this sample: watch it without a demo code. `recordedAt` is set while one is shown. */
  replay?: { onPlay: () => void; recordedAt?: string };
  /** Development only: save the finished run as this sample's recording. */
  onSave?: () => void;
};

const TOOL_LABELS: Record<string, string> = {
  get_frames: "Looking at frames",
  track: "Tracking with SAM 3.1",
  track_boxes: "Tracking from boxes with SAM 3.1",
  locate: "Finding in a still frame with SAM 3.1",
  set_pivot: "Setting the pivot",
  set_calibration: "Setting the scale",
  ask_user: "Asking you",
  analyse_pendulum: "Fitting the pendulum",
  analyse_collision: "Fitting the collision",
  finish: "Writing the report",
};

function argsLine(name: string, args: Record<string, unknown>): string {
  if (name === "track" || name === "locate") return `“${String(args.prompt ?? "")}”`;
  if (name === "get_frames" && Array.isArray(args.times_s)) return `at ${args.times_s.join(", ")} s`;
  return "";
}

function Report({ r }: { r: FinishReport }) {
  return (
    <div className="report">
      <p className="headline">{r.headline}</p>
      <p>{r.summary}</p>
      <p>
        <strong>Against the expected value:</strong> {r.comparison}
      </p>
      {r.setup_issues.length > 0 && (
        <>
          <strong>Setup issues</strong>
          <ul>
            {r.setup_issues.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      )}
      <p>
        <strong>Next trial:</strong> {r.next_trial}
      </p>
      {r.unverifiedNumbers && r.unverifiedNumbers.length > 0 && (
        <p className="unverified">
          Not taken from any measurement or note (the lab partner&apos;s own arithmetic or wording):{" "}
          {r.unverifiedNumbers.join(", ")}. Every other number above comes from Tracklab&apos;s fits.
        </p>
      )}
    </div>
  );
}

export function AgentPanel({
  ready,
  running,
  events,
  question,
  defaultNote,
  usage,
  onStart,
  onStop,
  onAnswer,
  replay,
  onSave,
}: Props) {
  const [note, setNote] = useState<string | undefined>();
  const [answer, setAnswer] = useState("");
  const done = events.findLast((e) => e.kind === "done");
  const cost =
    (usage.inputTokens * 1.25 + usage.outputTokens * 4.25) / 1e6 +
    (usage.samFrames * 0.2 + usage.samImages * 2.5) / 1000;

  return (
    <section className="panel agent">
      <h2>
        <span className="step">02</span> Lab partner <small>Muse Spark</small>
      </h2>
      {!running && (
        <div className="field">
          <label htmlFor="agent-note">
            Anything it should know? <small>e.g. a measured length, the masses, what the reference object is</small>
          </label>
          <textarea id="agent-note" rows={2} value={note ?? defaultNote} onChange={(e) => setNote(e.target.value)} />
          <div className="row">
            <button type="button" className="primary" disabled={!ready} onClick={() => onStart(note ?? defaultNote)}>
              {events.length > 0 ? "Run again" : "Analyse with the lab partner"}
            </button>
            {replay && (
              <button type="button" onClick={replay.onPlay}>
                Watch a recorded run
              </button>
            )}
            {!ready && <span className="muted">Load a video first.</span>}
          </div>
        </div>
      )}
      {running && (
        <div className="row">
          <span className="spinner" aria-hidden /> <span>Working…</span>
          <button type="button" onClick={onStop}>
            Stop
          </button>
        </div>
      )}

      {replay?.recordedAt && (
        <p className="muted replay-note">
          Recorded run from {new Date(replay.recordedAt).toLocaleDateString()}, replayed with no live calls.
        </p>
      )}
      {events.length > 0 && (
        <ol className="timeline" aria-live="polite">
          {events.map((e, i) => {
            if (e.kind === "say")
              return (
                <li key={i} className="say">
                  {e.text}
                </li>
              );
            if (e.kind === "call" && e.name !== "finish") {
              return (
                <li key={i} className="call">
                  {TOOL_LABELS[e.name] ?? e.name} <small>{argsLine(e.name, e.args)}</small>
                </li>
              );
            }
            if (e.kind === "result") {
              return (
                <li key={i} className={e.error ? "result error-text" : "result"}>
                  <details>
                    <summary>{e.error ? e.text : `${e.name} result`}</summary>
                    <pre>{e.text}</pre>
                  </details>
                  {e.images.length > 0 && (
                    <div className="thumbs">
                      {e.images.map((src, j) => (
                        // eslint-disable-next-line @next/next/no-img-element -- data URLs of captured frames
                        <img key={j} src={src} alt={`Frame ${j + 1} the lab partner looked at`} />
                      ))}
                    </div>
                  )}
                </li>
              );
            }
            return null;
          })}
        </ol>
      )}

      {question && (
        <form
          className="question"
          aria-live="assertive"
          onSubmit={(e) => {
            e.preventDefault();
            onAnswer(answer);
            setAnswer("");
          }}
        >
          <p>
            <strong>{question.question}</strong>
          </p>
          {question.answerType === "click_point" && (
            <p className="muted">Click the point on the video above, or type its pixel position as x, y.</p>
          )}
          {question.answerType === "click_line" && (
            <p className="muted">Click both ends on the video above, or type x1, y1, x2, y2 in pixels.</p>
          )}
          {
            <div className="row">
              <input
                autoFocus
                inputMode={question.answerType === "number" ? "decimal" : "text"}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                aria-label="Your answer"
              />
              {question.unit && <span>{question.unit}</span>}
              <button type="submit">Answer</button>
            </div>
          }
          <button
            type="button"
            className="link"
            onClick={() => {
              setAnswer("");
              onAnswer("");
            }}
          >
            Skip
          </button>
        </form>
      )}

      {done?.kind === "done" && done.report && <Report r={done.report} />}
      {done?.kind === "done" && !done.report && <p className="muted">{done.reason}</p>}
      {done?.kind === "done" && done.report && !running && onSave && (
        <button type="button" onClick={onSave}>
          Save as this sample&apos;s recorded run (dev only)
        </button>
      )}
      {(usage.inputTokens > 0 || usage.samFrames > 0) && (
        <p className="muted usage">
          Muse Spark {usage.inputTokens.toLocaleString()} in / {usage.outputTokens.toLocaleString()} out tokens · SAM{" "}
          {usage.samFrames.toLocaleString()} frames · about ${cost.toFixed(3)}
        </p>
      )}
    </section>
  );
}
