// Demo video, part 3: title cards + recorded scenes + narration -> video-out/tracklab-demo.mp4 (1920×1080, H.264/AAC).
// Waiting stretches of the live recording are sped up so each scene matches its narration; key moments (the click,
// the result) play in real time. Usage: tsx scripts/video/assemble.ts   (after record.ts and speak.ps1)
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import ffmpegPath from "ffmpeg-static";

const OUT = "video-out";
const FF = ffmpegPath as unknown as string;
// The app's own typefaces (Google Fonts, OFL), fetched into video-out/fonts; colours match the dark theme.
const MONO = "video-out/fonts/JetBrainsMono.ttf";
const DISPLAY = "video-out/fonts/SpaceGrotesk.ttf";
const BG = "0x0a0e13";
const SIGNAL = "0xc8f135";
const LOGO = "video-out/logo.png";
const FPS = 30;

type Scene = { id: string; text: string; card?: string[]; clip?: string };
const scenes = JSON.parse(readFileSync("scripts/video/narration.json", "utf8")) as Scene[];

function ff(args: string[]): void {
  const r = spawnSync(FF, ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ").slice(0, 300)}`);
}

function duration(file: string): number {
  const r = spawnSync(FF, ["-hide_banner", "-i", file], { encoding: "utf8" });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr);
  if (!m) throw new Error(`no duration for ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// drawtext runs with expansion=none, so only its option separators and quotes need escaping.
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019");

/**
 * A card in the app's style: blueprint grid on ink, the heading in Space Grotesk over a short lime rule, the rest in
 * JetBrains Mono. With a logo, it sits above the heading. Inputs: [0:v] background, [2:v] logo (if used).
 */
function cardFilter(lines: string[], seconds: number, logo: boolean): string {
  const [head, ...rest] = lines;
  // Space Grotesk averages about 0.52 em per character; keep the heading inside ~1700 px.
  const big = Math.min(rest.length ? 92 : 128, Math.floor(1700 / (head!.length * 0.52)));
  const logoH = logo ? 170 : 0;
  const total = logoH + big + 40 + rest.length * 60;
  let y = (1080 - total) / 2;
  const grid = `drawgrid=w=24:h=24:t=1:c=0x78aadc@0.05,drawgrid=w=120:h=120:t=1:c=0x78aadc@0.06`;
  const logoY = y;
  y += logoH;
  const parts = [
    `drawtext=fontfile='${DISPLAY}':text='${esc(head!)}':fontsize=${big}:fontcolor=0xe8edf2:expansion=none:x=(w-text_w)/2:y=${y}`,
  ];
  y += big + 18;
  parts.push(`drawbox=x=(iw-140)/2:y=${y}:w=140:h=5:color=${SIGNAL}:t=fill`);
  y += 40;
  for (const line of rest) {
    parts.push(
      `drawtext=fontfile='${MONO}':text='${esc(line)}':fontsize=36:fontcolor=0x9aa6b6:expansion=none:x=(w-text_w)/2:y=${y}`,
    );
    y += 60;
  }
  const fade = `fade=t=in:st=0:d=0.4,fade=t=out:st=${(seconds - 0.4).toFixed(2)}:d=0.4`;
  if (!logo) return `[0:v]${grid},${parts.join(",")},${fade}[v]`;
  return `[0:v]${grid},${parts.join(",")}[base];[2:v]scale=150:150[lg];[base][lg]overlay=x=(W-w)/2:y=${logoY},${fade}[v]`;
}

/** Trim [a, b) of the recording and play it `speed` times faster. */
const piece = (i: number, a: number, b: number, speed: number) =>
  `[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=(PTS-STARTPTS)/${speed.toFixed(4)}[p${i}]`;

/** Fixed-speed and sped-up stretches for each recorded scene, timed from record.ts marks to fit `target` seconds. */
function clipPlan(id: string, target: number): { a: number; b: number; speed?: number }[] {
  const m = JSON.parse(readFileSync(`${OUT}/${id}.json`, "utf8")) as Record<string, number>;
  if (id === "classroom") {
    const fixed = [
      { a: m.loaded! - 1, b: m.started! + 1 },
      { a: m.question! - 0.5, b: m.clicked! + 2.5 },
      { a: m.report! - 0.5, b: m.end! - 0.5 },
    ];
    const fast = [
      { a: m.started! + 1, b: m.question! - 0.5 },
      { a: m.clicked! + 2.5, b: m.report! - 0.5 },
    ];
    const fixedLen = fixed.reduce((s, p) => s + p.b - p.a, 0);
    const fastLen = fast.reduce((s, p) => s + p.b - p.a, 0);
    const speed = Math.max(1, fastLen / Math.max(4, target - fixedLen));
    return [fixed[0]!, { ...fast[0]!, speed }, fixed[1]!, { ...fast[1]!, speed }, fixed[2]!];
  }
  const fixedLen = m.end! - 0.5 - m.report!;
  const fastLen = m.report! - (m.loaded! - 0.5);
  const speed = Math.max(1, fastLen / Math.max(4, target - fixedLen));
  return [
    { a: m.loaded! - 0.5, b: m.report!, speed },
    { a: m.report!, b: m.end! - 0.5 },
  ];
}

const LABELS: Record<string, string> = {
  classroom: "Real classroom footage · live run · Muse Spark lab partner + SAM 3.1",
  collision: "Recorded lab-partner run · synthetic collision",
};

const parts: string[] = [];
for (const s of scenes) {
  const voice = `${OUT}/voice-${s.id}.wav`;
  const v = duration(voice);
  const out = `${OUT}/scene-${s.id}.mp4`;
  const audio = ["-i", voice];
  const encode = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS)];
  const audioEnc = ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "1"];
  if (s.card) {
    const len = v + 1.4;
    const logo = s.id === "title" || s.id === "close";
    ff([
      "-f",
      "lavfi",
      "-i",
      `color=c=${BG}:s=1920x1080:r=${FPS}:d=${len.toFixed(2)}`,
      ...audio,
      ...(logo ? ["-i", LOGO] : []),
      "-filter_complex",
      `${cardFilter(s.card, len, logo)};[1:a]adelay=500|500,apad[a]`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-t",
      len.toFixed(2),
      ...encode,
      ...audioEnc,
      out,
    ]);
  } else {
    const target = v + 1.5;
    const plan = clipPlan(s.clip!, target);
    const filters = plan.map((p, i) => piece(i, p.a, p.b, p.speed ?? 1));
    const len = plan.reduce((t, p) => t + (p.b - p.a) / (p.speed ?? 1), 0);
    filters.push(
      `${plan.map((_, i) => `[p${i}]`).join("")}concat=n=${plan.length}:v=1:a=0,fps=${FPS},` +
        `scale=1920:1080:flags=lanczos,` +
        `drawbox=x=0:y=0:w=iw:h=58:color=0x0a0e13@0.82:t=fill,` +
        `drawbox=x=28:y=22:w=14:h=14:color=${SIGNAL}:t=fill,` +
        `drawtext=fontfile='${MONO}':text='${esc(LABELS[s.clip!] ?? "")}':fontsize=26:fontcolor=0xe8edf2:expansion=none:x=56:y=15,` +
        `fade=t=in:st=0:d=0.3,fade=t=out:st=${(len - 0.3).toFixed(2)}:d=0.3[v]`,
      `[1:a]adelay=400|400,apad[a]`,
    );
    ff([
      "-i",
      `${OUT}/${s.clip}.webm`,
      ...audio,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-t",
      len.toFixed(2),
      ...encode,
      ...audioEnc,
      out,
    ]);
    console.log(
      `${s.id}: ${len.toFixed(1)} s (narration ${v.toFixed(1)} s), speed-ups ${plan.map((p) => (p.speed ?? 1).toFixed(2)).join("/")}`,
    );
  }
  parts.push(out);
}

writeFileSync(`${OUT}/parts.txt`, parts.map((p) => `file '${p.replace(`${OUT}/`, "")}'`).join("\n"));
ff([
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  `${OUT}/parts.txt`,
  "-c",
  "copy",
  "-movflags",
  "+faststart",
  `${OUT}/tracklab-demo.mp4`,
]);
console.log(`tracklab-demo.mp4: ${duration(`${OUT}/tracklab-demo.mp4`).toFixed(1)} s`);
