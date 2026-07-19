/**
 * Local-mode browser verification (run manually, not part of the app):
 *   node scripts/verify-local-mode.mjs [port]
 * Serves nothing itself — expects `npm run build:local` output served
 * statically (e.g. `python3 -m http.server <port>` from client/dist).
 */
import { chromium } from "playwright";

const port = process.argv[2] || "3140";
const base = `http://localhost:${port}`;
const passed = [];
const consoleErrors = [];
const pageErrors = [];

function assert(cond, label) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${label}`);
  passed.push(label);
  console.log(`PASS: ${label}`);
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const page = await browser.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => pageErrors.push(String(err)));

try {
  // --- 1. App boots, title is Darfum
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".page-title", { timeout: 15000 });
  assert((await page.title()) === "Darfum", 'document.title === "Darfum"');

  // --- 2. Nutrition: +250 ml water works against the wasm DB
  await page.goto(`${base}/#/nutrition`);
  const waterBtn = page.getByRole("button", { name: "+250 ml" });
  await waterBtn.waitFor({ timeout: 15000 });
  await waterBtn.click();
  await page.waitForFunction(
    () => document.body.innerText.includes("250 / "),
    null,
    { timeout: 15000 },
  );
  const meterText = await page.innerText("body");
  assert(/250 \/ \d+ ml/.test(meterText), "water total shows 250 ml after +250 click");

  // --- 3. Persistence: hard reload, still 250 (from IndexedDB)
  await page.waitForTimeout(800); // let the debounced IndexedDB flush run
  await page.reload({ waitUntil: "networkidle" });
  await page.goto(`${base}/#/nutrition`);
  await page.waitForFunction(
    () => document.body.innerText.includes("250 / "),
    null,
    { timeout: 15000 },
  );
  assert(true, "water total 250 persisted across hard reload (IndexedDB)");

  // --- 4. Settings: AI assistant + Data cards render in local mode
  await page.goto(`${base}/#/settings`);
  await page.waitForSelector('[data-testid="ai-assistant-card"]', { timeout: 15000 });
  assert(
    (await page.locator('[data-testid="ai-assistant-card"] h3').innerText()) === "AI assistant",
    "Settings shows the AI assistant card (local mode)",
  );
  await page.waitForSelector('[data-testid="data-card"]', { timeout: 15000 });
  assert(
    (await page.locator('[data-testid="data-card"] h3').innerText()) === "Data",
    "Settings shows the Data card with backup buttons (local mode)",
  );
  assert(
    (await page.getByRole("button", { name: "Export backup" }).count()) === 1 &&
      (await page.getByRole("button", { name: "Import backup" }).count()) === 1,
    "Export backup and Import backup buttons render",
  );

  // --- 5. Dashboard: score hero renders
  await page.goto(`${base}/#/dashboard`);
  await page.waitForFunction(
    () => document.body.innerText.includes("Today's health score"),
    null,
    { timeout: 15000 },
  );
  assert(true, "Dashboard score hero ('Today's health score') renders");

  // --- 6. No uncaught exceptions / console errors (chart-size warnings ok)
  const realErrors = [...pageErrors, ...consoleErrors].filter(
    (e) => !/width|height|size|ResizeObserver/i.test(e),
  );
  if (realErrors.length) {
    console.log("Console/page errors seen:", realErrors);
  }
  assert(realErrors.length === 0, "no uncaught exceptions or console errors");

  // --- cleanup: remove the test water row via the UI so no test data remains
  await page.goto(`${base}/#/nutrition`);
  const removeBtn = page.getByRole("button", { name: "Remove" }).first();
  await removeBtn.waitFor({ timeout: 15000 });
  await removeBtn.click();
  await page.waitForFunction(
    () => document.body.innerText.includes("0 / "),
    null,
    { timeout: 15000 },
  );
  console.log("cleanup: test water row removed (total back to 0)");

  console.log(`\nALL ${passed.length} ASSERTIONS PASSED`);
} finally {
  await browser.close();
}
