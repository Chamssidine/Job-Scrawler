import axios from "axios";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";
import { extractSignals } from "./extract.js";
import { filterUrlsWithAI } from "./urlFilter.js";
import { URL } from "url";

export async function crawlPage(url) {
  let baseDomain;
  try {
    baseDomain = new URL(url).origin;
  } catch {
    return null;
  }

  let finalData = null;
  let browser = null; // Déclarer le navigateur ici pour pouvoir le fermer en cas d'erreur

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

    if (signals.emails.length > 0 && signals.text.length > 400 && !signals.hasForm) {
      finalData = {
        url,
        text: signals.text,
        emails: signals.emails,
        hasForm: signals.hasForm,
        links: signals.links
      };
    }
  } catch (err) {
    console.log(`Axios échoué pour ${url}, tentative Puppeteer...`);
  }

  /* =====================
     2️⃣ Fallback Puppeteer
     ===================== */
  if (!finalData) {
    try {
      browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
      });
      const page = await browser.newPage();

      // --- DÉGUISENENT DU ROBOT ---
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
      );
      // --------------------------

      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
      
      finalData = await page.evaluate(() => {
        const EMAIL_REGEX = /[A-Z0-9._%+-]+(?:\s?\[at\]\s?|\s?\(at\)\s?|@)[A-Z0-9.-]+\.[A-Z]{2,}/gi;
        const text = document.body.innerText || "";
        
        const rawEmails = text.match(EMAIL_REGEX) || [];
        const emails = [...new Set(rawEmails.map(e => 
          e.replace(/\[at\]|\(at\)/gi, "@").replace(/\s/g, "").toLowerCase()
        ))];
        
        let hasForm = false;
        document.querySelectorAll("form").forEach(f => {
          if (f.innerText.match(/bewerb|upload|cv|apply|senden|datei|lebenslauf/i)) hasForm = true;
        });

        const links = Array.from(document.querySelectorAll("a"))
          .map(a => a.href)
          .filter(h => h && h.startsWith(window.location.origin));

        return { text, emails, hasForm, links };
      });

      await browser.close();
      browser = null; // Réinitialiser après fermeture réussie

    } catch (err) {
      console.error(`Erreur critique Puppeteer sur ${url}:`, err.message);
      if (browser) await browser.close(); // S'assurer de fermer le navigateur même en cas d'erreur
      return null;
    }
  }

  /* =====================
     3️⃣ Filtrage Intelligent Final
     ===================== */
  if (finalData && finalData.links) {
    const cleanLinks = [...new Set(finalData.links)].filter(link => {
      if (!link || !link.startsWith("http") || link.includes("#")) return false;
      const bullshit = /impressum|datenschutz|privacy|contact|kontakt|presse|login|newsletter/i;
      return !bullshit.test(link);
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