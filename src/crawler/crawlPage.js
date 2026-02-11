import axios from "axios";
import * as cheerio from "cheerio";
import { extractSignals } from "./extract.js";
import { filterUrlsWithAI } from "./urlFilter.js";
import { URL } from "url";
import { normalizeUrl } from "../core/url.js";
import { withPage } from "./browser.js";

export async function crawlPage(url) {
  let baseDomain;
  try {
    baseDomain = new URL(url).origin;
  } catch {
    return null;
  }

  let finalData = null;

  /* =====================
     1️⃣ Tentative Axios (Rapide)
     ===================== */
  try {
    const res = await axios.get(url, {
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
      }
    });

    const $ = cheerio.load(res.data);
    const signals = extractSignals($, url);

    // Toujours renvoyer les signaux, même sans emails: utile pour pages de liste
    finalData = {
      url,
      text: signals.text,
      emails: signals.emails,
      hasForm: signals.hasForm,
      links: signals.links
    };
  } catch (err) {
    console.log(`Axios échoué pour ${url}, tentative Puppeteer...`);
  }

  /* =====================
     2️⃣ Fallback Puppeteer
     ===================== */
  if (!finalData) {
    try {
      finalData = await withPage(async (page) => {
        // Navigation avec retry simple pour "Execution context was destroyed"
        const nav = async () => {
          try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
            await page.waitForSelector('body', { timeout: 15000 });
          } catch (e) {
            if ((e.message || '').includes('Execution context was destroyed')) {
              // Retenter une fois
              await page.waitForTimeout(1000);
              await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
              await page.waitForSelector('body', { timeout: 15000 });
            } else {
              throw e;
            }
          }
        };
        await nav();

        const data = await page.evaluate(() => {
          const EMAIL_REGEX = /[A-Z0-9._%+-]+(?:\s?\[at\]\s?|\s?\(at\)\s?|@)[A-Z0-9.-]+\.[A-Z]{2,}/gi;
          const text = document.body.innerText || "";
          const rawEmails = text.match(EMAIL_REGEX) || [];
          const emails = [...new Set(rawEmails.map(e => e.replace(/\[at\]|\(at\)/gi, "@").replace(/\s/g, "").toLowerCase()))];
          let hasForm = false;
          document.querySelectorAll("form").forEach(f => { if (f.innerText.match(/bewerb|upload|cv|apply|senden|datei|lebenslauf/i)) hasForm = true; });
          const links = Array.from(document.querySelectorAll("a")).map(a => a.href).filter(h => h && h.startsWith(window.location.origin));
          return { text, emails, hasForm, links };
        });
        return data;
      });
    } catch (err) {
      console.error(`Erreur critique Puppeteer sur ${url}:`, err.message);
      return null;
    }
  }

  /* =====================
     3️⃣ Filtrage Intelligent Final
     ===================== */
  if (!finalData) {
    console.warn(`⚠️ Pas de données crawlées pour ${url}`);
    return null;
  }

  console.log(`📄 Données extraites: ${finalData.text?.length || 0} chars, ${finalData.emails?.length || 0} emails, ${finalData.links?.length || 0} liens`);

  if (finalData && finalData.links) {
    const noiseQuery = /(tx_bafzacookiebar|CookieWarning|closeCookieBar|cHash=|type=\d+)/i;
    const cleanLinks = [...new Set(finalData.links.map(normalizeUrl))].filter(link => {
      if (!link || !link.startsWith("http") || link.includes("#")) return false;
      // Écarter liens évidents non pertinents
      const blacklist = /impressum|datenschutz|privacy|kontakt|contact|presse|login|newsletter|agb|sitemap|facebook|twitter|instagram|linkedin|\.pdf$/i;
      if (blacklist.test(link)) return false;
      if (noiseQuery.test(link)) return false;
      return true;
    });

    if (cleanLinks.length > 0) {
      console.log(`🤖 IA : Validation de ${cleanLinks.length} liens...`);
      finalData.links = await filterUrlsWithAI(cleanLinks, url); 
    } else {
      finalData.links = [];
    }

    finalData.url = url;
  }

  return finalData;
}