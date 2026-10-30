/**
 * Roles editor evidence probe (Agent R3, read-only).
 *
 * Captures the SHIPPED /admin/roles DOM as it exists at probe time across
 * desktop (1280/1440/1920) and mobile (375/390) viewports without
 * authenticating, mutating data, or starting servers. When the app is
 * healthy, an unauthenticated visit redirects to /sign-in (recorded as a
 * behavior fact); when it 500s, the failure state is recorded instead.
 *
 * Run: bun .playwright/roles-evidence.mjs
 * Output: .playwright/roles/<WxH>-*.png + report.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3001";
const OUT_DIR = join(process.cwd(), ".playwright", "roles");

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
];

const probePage = async (page, url) => {
  let status = null;
  let finalUrl = url;

  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

    status = response?.status() ?? null;
    finalUrl = page.url();
    await page.waitForTimeout(1500);
  } catch (error) {
    return { url, finalUrl, status, error: String(error).slice(0, 300), signals: null };
  }

  const signals = await page.evaluate(() => {
    const text = document.body?.innerText ?? "";

    return {
      bodyLength: text.length,
      bodyHead: text.slice(0, 400),
      hasSignIn: /sign in/i.test(text),
      hasRolesHeading: /roles/i.test(text),
      // Stacked-form (old) DOM markers.
      stackedNameInputs: document.querySelectorAll('input[name^="roleName-"]').length,
      stackedDescInputs: document.querySelectorAll('input[name^="roleDescription-"]').length,
      // Generic two-pane markers (new editor may use any of these).
      listItems: document.querySelectorAll("main li, [role='list'] > *, ul > li").length,
      buttons: [...document.querySelectorAll("button")]
        .map((b) => (b.textContent ?? "").trim())
        .filter(Boolean)
        .slice(0, 20),
      hasBackButton: /back/i.test(text),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

  return { url, finalUrl, status, error: null, signals };
};

const main = async () => {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const findings = [];

  try {
    for (const viewport of VIEWPORTS) {
      const label = `${viewport.width}x${viewport.height}`;
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();

      const roles = await probePage(page, `${BASE}/admin/roles`);

      await page.screenshot({ path: join(OUT_DIR, `${label}-roles.png`) });

      const signin = await probePage(page, `${BASE}/sign-in`);

      await page.screenshot({ path: join(OUT_DIR, `${label}-signin.png`) });
      findings.push({ viewport: label, roles, signin });

      await context.close();
    }
  } finally {
    await browser.close();
  }

  const healthy = findings.every((f) => f.roles.status !== 500 && f.signin.status !== 500);
  const report = {
    base: BASE,
    capturedAt: new Date().toISOString(),
    verdict: healthy ? "HEALTHY" : "BLOCKED",
    viewports: findings,
  };

  writeFileSync(join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ verdict: report.verdict, viewports: findings.length }));
};

await main();
