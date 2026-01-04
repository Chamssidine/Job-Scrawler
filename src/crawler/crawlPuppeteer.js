// crawlPuppeteer.js
import puppeteer from "puppeteer";

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export async function crawlWithPuppeteer(url) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "networkidle2" });
  await page.waitForSelector("body"); // on peut affiner si tu as un conteneur spécifique

  const result = await page.evaluate(() => {
    const emails = Array.from(document.body.innerText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []);
    return { emails, hasForm: document.querySelectorAll("form").length > 0 };
  });

  await browser.close();
  return { url, ...result, links: [], text: "" };
}
