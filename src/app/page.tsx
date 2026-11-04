import { existsSync } from "node:fs";
import path from "node:path";
import { Lab } from "@/client/components/Lab";
import { Logo } from "@/client/components/Logo";
import type { SampleInfo } from "@/shared/api";
import { env } from "@/server/env";
import { samples, workingConceptPrompts } from "@/server/samples";

export default function Home() {
  const list: SampleInfo[] = samples().map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    credit: s.credit,
    creditUrl: s.creditUrl,
    video: s.video,
    hasReplay: existsSync(path.join(process.cwd(), "public", "replays", `${s.id}.json`)),
    cachedPrompts: Object.keys(s.cached)
      .filter((k) => k.startsWith("concept:"))
      .map((k) => k.slice("concept:".length)),
    suggestedPrompt: workingConceptPrompts(s)[0],
  }));
  return (
    <>
      <header className="masthead">
        <div className="brand">
          <Logo size={46} />
          <h1>tracklab</h1>
        </div>
        <p className="tagline">
          Film an experiment. Get a <em>measurement</em> you can trust.
        </p>
        <ul className="stack" aria-label="How it works">
          <li>SAM 3.1 tracks every frame</li>
          <li>Muse Spark runs the lab</li>
          <li>fits with honest error bars</li>
        </ul>
      </header>
      <Lab samples={list} uploadMode={env().BLOB_READ_WRITE_TOKEN ? "token" : "presigned"} />
    </>
  );
}
