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

  /* =====================
     1️⃣ Tentative Axios (Rapide)
     ===================== */
  try {
    const res = await axios.get(url, {
      timeout: 30000,
      headers: {
        "User-Agent": "IntlJobAgent/1.0 (research)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    const $ = cheerio.load(res.data);
    const signals = extractSignals($, url); // Utilise déjà la nouvelle regex

    // Si on a déjà des emails, on gagne du temps
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
      const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
      });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
      
      finalData = await page.evaluate(() => {
        // Nouvelle regex incluse ici pour Puppeteer
        const EMAIL_REGEX = /[A-Z0-9._%+-]+(?:\s?\[at\]\s?|\s?\(at\)\s?|@)[A-Z0-9.-]+\.[A-Z]{2,}/gi;
        
        const text = document.body.innerText || "";
        
        // Extraction et Normalisation immédiate dans le navigateur
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
    } catch (err) {
      console.error(`Erreur critique Puppeteer sur ${url}:`, err.message);
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