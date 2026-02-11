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
      links: signals.links,
      nextLink: signals.nextLink || null,
      job: signals.job || null
    };
  } catch (err) {
    console.log(`Axios échoué pour ${url}, tentative Puppeteer...`);
  }

  /* =====================
     2️⃣ Fallback/Boost Puppeteer
     - Utilisé si Axios a échoué OU si trop peu de liens découverts (page dynamique)
     ===================== */
  if (!finalData || (finalData && Array.isArray(finalData.links) && finalData.links.length < 10)) {
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

        // Auto-scroll pour l'infinite scroll / chargement lazy
        async function autoScroll(maxSteps = 8){
          for(let i=0;i<maxSteps;i++){
            try{
              await page.evaluate(() => new Promise(resolve => {
                const distance = 1200; const delay = 200;
                const { scrollTop, scrollHeight, clientHeight } = document.scrollingElement || document.documentElement;
                window.scrollBy(0, distance);
                setTimeout(resolve, delay);
              }));
              await page.waitForTimeout(300);
            }catch{}
          }
        }
        await autoScroll();

        const data = await page.evaluate(() => {
          const EMAIL_REGEX = /[A-Z0-9._%+-]+(?:\s?\[at\]\s?|\s?\(at\)\s?|@)[A-Z0-9.-]+\.[A-Z]{2,}/gi;
          const text = document.body.innerText || "";
          const rawEmails = text.match(EMAIL_REGEX) || [];
          const emails = [...new Set(rawEmails.map(e => e.replace(/\[at\]|\(at\)/gi, "@").replace(/\s/g, "").toLowerCase()))];
          let hasForm = false;
          document.querySelectorAll("form").forEach(f => { if (f.innerText.match(/bewerb|upload|cv|apply|senden|datei|lebenslauf/i)) hasForm = true; });
          const links = Array.from(document.querySelectorAll("a")).map(a => a.href).filter(h => h && h.startsWith(window.location.origin));
          // next link detection
          let nextLink = null;
          const relNext = document.querySelector('link[rel="next"]');
          if (relNext && relNext.getAttribute('href')) nextLink = new URL(relNext.getAttribute('href'), window.location.href).href;
          if (!nextLink) {
            const NEXT_RX = /(weiter|nächste|next|more|load\s*more|vorwärts|older|page\s*\d+|»|›)/i;
            const anchors = Array.from(document.querySelectorAll('a'));
            for (const a of anchors){
              const t = (a.textContent||'').trim();
              if(NEXT_RX.test(t) && a.getAttribute('href')){ try{ nextLink = new URL(a.getAttribute('href'), window.location.href).href; break; }catch{} }
            }
          }
          return { text, emails, hasForm, links, nextLink };
        });
        return data;
      });
    } catch (err) {
      console.error(`Erreur critique Puppeteer sur ${url}:`, err.message);
      if (!finalData) return null; // si axios déjà dispo, garder au moins ça
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
    // Prioriser lien 'next' si présent
    const prioritized = [];
    if (finalData.nextLink) {
      try { prioritized.push(normalizeUrl(finalData.nextLink)); } catch {}
    }
    const cleanLinks = [...new Set([...prioritized, ...finalData.links.map(normalizeUrl)])].filter(link => {
      if (!link || !link.startsWith("http") || link.includes("#")) return false;
      // Écarter liens évidents non pertinents
      const blacklist = /impressum|datenschutz|privacy|kontakt|contact|presse|login|newsletter|agb|sitemap|facebook|twitter|instagram|linkedin|\.pdf$/i;
      if (blacklist.test(link)) return false;
      if (noiseQuery.test(link)) return false;
      return true;
    });

    if (cleanLinks.length > 0) {
      console.log(`🤖 IA : Validation de ${cleanLinks.length} liens...`);
      const aiSelected = await filterUrlsWithAI(cleanLinks, url);
      // S'assurer que nextLink reste présent en tête
      const nextNorm = finalData.nextLink ? normalizeUrl(finalData.nextLink) : null;
      let merged = [...new Set([nextNorm, ...aiSelected].filter(Boolean))];
      // Fallback sécure si l'IA écarte tout: garder des patterns de listing courants
      if (merged.length === 0) {
        const allowRx = /(aktuelle-ausbildungsplaetze|aktuelle-duale-studienplaetze|\/unternehmen\/.+\/stellen|\/suche\/?|\bjobs?\b)/i;
        merged = cleanLinks.filter(l => allowRx.test(l)).slice(0, 50);
        if (nextNorm) merged = [...new Set([nextNorm, ...merged])];
      }
      finalData.links = merged; 
    } else {
      finalData.links = [];
    }

    finalData.url = url;
  }

  return finalData;
}