// Design check: screenshot the app in dark and light at desktop width and on a phone, after a recorded run plays.
// Usage: tsx scripts/video/screens.ts <base-url>   (writes video-out/screen-*.png)
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3100";
mkdirSync("video-out", { recursive: true });
const browser = await chromium.launch();
const shots = [
  { name: "dark-desktop", scheme: "dark" as const, w: 1440, h: 900, mobile: false },
  { name: "light-desktop", scheme: "light" as const, w: 1440, h: 900, mobile: false },
  { name: "dark-phone", scheme: "dark" as const, w: 390, h: 844, mobile: true },
];
for (const s of shots) {
  const page = await browser.newPage({
    viewport: { width: s.w, height: s.h },
    colorScheme: s.scheme,
    isMobile: s.mobile,
    deviceScaleFactor: s.mobile ? 2 : 1,
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.screenshot({ path: `video-out/screen-${s.name}-home.png` });
  await page.getByRole("button", { name: "Classroom pendulum (real footage)" }).click();
  await page.getByText(/\d+ frames, [\d.]+ fps/).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "Watch a recorded run" }).click();
  await page.locator(".report").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `video-out/screen-${s.name}-run.png`, fullPage: s.mobile ? false : true });
  await page.close();
}
await browser.close();
console.log("screens done");
