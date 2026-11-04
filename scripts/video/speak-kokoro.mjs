// Run from a separate folder with kokoro-js@1.2.1 installed (kept out of the app so Vercel builds stay light):
//   cd ../tts-kokoro && node speak.mjs ../tracklab/scripts/video/narration.json ../tracklab/video-out af_heart
// Narration with Kokoro (open-weight neural TTS, Apache-2.0), run locally.
// Kokoro truncates long inputs, so each scene is spoken sentence by sentence and joined with short pauses.
// Usage: node speak.mjs <narration.json> <out-dir> [voice] [--sample]
import { readFileSync, writeFileSync } from "node:fs";
import { KokoroTTS } from "kokoro-js";

const [narrationFile, outDir, voiceArg] = process.argv.slice(2);
const sample = process.argv.includes("--sample");
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });

/** Mono 16-bit PCM WAV. */
function writeWav(path, samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-1, Math.min(1, v)) * 0x7fff, i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

async function speak(text, voice) {
  const sentences = text.match(/[^.!?]+[.!?]+["”]?\s*|[^.!?]+$/g) ?? [text];
  const parts = [];
  let rate = 24000;
  for (const s of sentences.map((x) => x.trim()).filter(Boolean)) {
    const audio = await tts.generate(s, { voice, speed: 1.0 });
    rate = audio.sampling_rate;
    parts.push(audio.audio, new Float32Array(Math.round(rate * 0.28)));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return { samples: out, rate };
}

if (sample) {
  const line = "This is Tracklab. Film a physics experiment, and a lab partner measures it, with honest error bars.";
  for (const v of ["af_heart", "af_bella", "am_michael", "bf_emma", "am_fenrir"]) {
    const { samples, rate } = await speak(line, v);
    writeWav(`${outDir}/sample-${v}.wav`, samples, rate);
    console.log(`sample-${v}.wav`);
  }
} else {
  const voice = voiceArg ?? "af_heart";
  for (const s of JSON.parse(readFileSync(narrationFile, "utf8"))) {
    const { samples, rate } = await speak(s.text, voice);
    writeWav(`${outDir}/voice-${s.id}.wav`, samples, rate);
    console.log(`voice-${s.id}.wav ${(samples.length / rate).toFixed(1)} s`);
  }
}
