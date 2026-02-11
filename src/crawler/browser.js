import puppeteer from "puppeteer";

let browser = null;
const MAX_PAGES = parseInt(process.env.PUPPETEER_MAX_PAGES || '3', 10);
let activePages = 0;
const waiters = [];

export async function getBrowser() {
  if (browser && (await browser.process()) != null) return browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-blink-features=AutomationControlled"
      ],
      defaultViewport: { width: 1366, height: 768 },
    });
  } catch (e) {
    console.error("Échec du lancement de Puppeteer:", e.message);
    throw e;
  }
  return browser;
}

export async function closeBrowser() {
  if (browser) {
    try { await browser.close(); } catch {}
    browser = null;
  }
}

async function acquireSlot() {
  if (activePages < MAX_PAGES) {
    activePages++;
    return;
  }
  await new Promise(resolve => waiters.push(resolve));
  activePages++;
}

function releaseSlot() {
  activePages = Math.max(0, activePages - 1);
  const next = waiters.shift();
  if (next) next();
}

export async function withPage(fn) {
  await acquireSlot();
  const br = await getBrowser();
  const page = await br.newPage();
  try {
    // Stealth-lite
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setJavaScriptEnabled(true);
    return await fn(page);
  } finally {
    try { await page.close(); } catch {}
    releaseSlot();
  }
}
