"use client";

/** Last-resort boundary: an unexpected error shows a way back instead of a blank page. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="panel" role="alert">
      <h2>Something went wrong</h2>
      <p className="muted">{error.message || "An unexpected error occurred."}</p>
      <button type="button" className="primary" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
