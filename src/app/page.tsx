import { Lab } from "@/client/components/Lab";
import type { SampleInfo } from "@/shared/api";
import { samples } from "@/server/samples";

export default function Home() {
  const list: SampleInfo[] = samples().map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    credit: s.credit,
    creditUrl: s.creditUrl,
    video: s.video,
    cachedPrompts: Object.keys(s.cached)
      .filter((k) => k.startsWith("concept:"))
      .map((k) => k.slice("concept:".length)),
  }));
  return (
    <>
      <header className="masthead">
        <h1>Tracklab</h1>
        <p>Film a physics experiment. SAM 3.1 tracks it frame by frame; the fits measure it, with honest error bars.</p>
      </header>
      <Lab samples={list} />
    </>
  );
}
