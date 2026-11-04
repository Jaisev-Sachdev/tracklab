// Demo video, part 1: drive the site in a real browser and record each scene at 1920×1080.
// Scene "classroom": a live lab-partner run on the real classroom pendulum, answering its click question at the bob.
// Scene "collision": the recorded lab-partner run on the synthetic collision.
// Writes video-out/<scene>.webm and video-out/<scene>.json (timestamps of key moments, in seconds).
// Usage: tsx scripts/video/record.ts <base-url> <demo-code> <bob-positions.json> [scene...]
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";

const [base, code, positionsFile, ...only] = process.argv.slice(2);
if (!base || !code || !positionsFile) throw new Error("usage: record.ts <base-url> <demo-code> <positions.json>");
const positions = JSON.parse(readFileSync(positionsFile, "utf8")) as Record<string, [number, number]>;
const OUT = "video-out";
mkdirSync(OUT, { recursive: true });

// A ripple wherever the mouse goes down, so viewers see the click.
const RIPPLE = `
addEventListener("mousedown", (e) => {
  const d = document.createElement("div");
  Object.assign(d.style, { position: "fixed", left: e.clientX - 22 + "px", top: e.clientY - 22 + "px", width: "44px",
    height: "44px", borderRadius: "50%", border: "4px solid #ffcc00", zIndex: 99999, pointerEvents: "none",
    transition: "transform 0.6s ease-out, opacity 0.6s ease-out" });
  document.body.appendChild(d);
  requestAnimationFrame(() => { d.style.transform = "scale(1.8)"; d.style.opacity = "0"; });
  setTimeout(() => d.remove(), 800);
}, true);`;

async function scene(name: string, run: (page: Page, mark: (label: string) => void) => Promise<void>) {
  if (only.length && !only.includes(name)) return;
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
  });
  await context.addInitScript(RIPPLE);
  const page = await context.newPage();
  const t0 = Date.now();
  const marks: Record<string, number> = {};
  const mark = (label: string) => {
    marks[label] = (Date.now() - t0) / 1000;
    console.log(`${name} ${label} @ ${marks[label]!.toFixed(1)} s`);
  };
  try {
    await run(page, mark);
  } finally {
    mark("end");
    const video = page.video();
    await context.close();
    await browser.close();
    if (video) renameSync(await video.path(), `${OUT}/${name}.webm`);
    writeFileSync(`${OUT}/${name}.json`, JSON.stringify(marks, null, 2));
  }
}

async function openSample(page: Page, title: string) {
  await page.goto(base!, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: title }).click();
  await page.getByText(/\d+ frames, [\d.]+ fps/).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
}

async function scrollTo(page: Page, selector: string) {
  await page
    .locator(selector)
    .last()
    .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  await page.waitForTimeout(1500);
}

await scene("classroom", async (page, mark) => {
  await openSample(page, "Classroom pendulum (real footage)");
  mark("loaded");
  await page.locator('input[type="password"]').pressSequentially(code!, { delay: 25 });
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Analyse with the lab partner" }).click();
  mark("started");

  // Either it asks for a click (the bob is hard to find) or it finishes on its own.
  const asked = await Promise.race([
    page
      .locator(".question")
      .waitFor({ timeout: 240_000 })
      .then(() => true),
    page
      .locator(".report")
      .waitFor({ timeout: 240_000 })
      .then(() => false),
  ]);
  if (asked) {
    mark("question");
    await page.waitForTimeout(2500);
    const frame = Number(await page.locator(".frame-readout").getAttribute("data-frame"));
    const keys = Object.keys(positions).map(Number);
    const nearest = keys.reduce((a, b) => (Math.abs(b - frame) < Math.abs(a - frame) ? b : a));
    const [sx, sy] = positions[nearest]!;
    const box = (await page.locator(".overlay").boundingBox())!;
    const x = box.x + (sx * box.width) / 1920;
    const y = box.y + (sy * box.height) / 1080;
    await page.mouse.move(x - 160, y - 120);
    await page.mouse.move(x, y, { steps: 25 });
    await page.waitForTimeout(400);
    await page.mouse.click(x, y);
    mark("clicked");
  }
  await page.locator(".report").waitFor({ timeout: 300_000 });
  mark("report");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(1500);
  await scrollTo(page, ".results");
  mark("results");
  await page.waitForTimeout(6000);
  await scrollTo(page, ".report");
  mark("report-view");
  await page.waitForTimeout(9000);
});

await scene("collision", async (page, mark) => {
  await openSample(page, "Synthetic collision");
  mark("loaded");
  await page.getByRole("button", { name: "Watch a recorded run" }).click();
  mark("started");
  await page.locator(".report").waitFor({ timeout: 120_000 });
  mark("report");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(1000);
  await scrollTo(page, ".results");
  mark("results");
  await page.waitForTimeout(6000);
});

console.log("done");
