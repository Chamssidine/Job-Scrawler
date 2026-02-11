// extract.js
import { URL } from "url";

// Cette regex capture @, [at], (at), et les espaces autour pour contrer le masquage
const EMAIL_REGEX = /[A-Z0-9._%+-]+(?:\s?\[at\]\s?|\s?\(at\)\s?|@)[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const BLOCKLIST = [
  "login", "register", "anmeldung", "passwort", 
  "impressum", "datenschutz", "agb", "privacy", 
  "javascript:", "mailto:", "tel:", "#", 
  "gebaerdensprache", "leichte-sprache", "presse", "kontakt",
  // Parasites courants
  "cookie", "cookiebar", "CookieWarning", "tx_bafzacookiebar", "cHash=", "type=",
  // Réseaux sociaux et docs
  "facebook.com", "twitter.com", "instagram.com", "linkedin.com", ".pdf"
];

export function extractSignals($, baseUrl) {
  // 1. Nettoyage agressif pour ne garder que le contenu utile
  $("script, style, nav, footer, header, .cookie-banner, .menu").remove();

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();

  // 2. Extraction et Normalisation des emails
  const rawEmails = bodyText.match(EMAIL_REGEX) || [];
  const emails = [...new Set(rawEmails.map(email => {
    return email
      .replace(/\[at\]|\(at\)/gi, "@") // Transforme [at] en @
      .replace(/\s/g, "")             // Enlève les espaces (ex: "bfd @ domain.de")
      .toLowerCase();
  }))];

  // 3. Détection intelligente du formulaire de candidature
  const formHtml = $("form").html() || "";
  const isApplicationForm = /upload|datei|cv|lebenslauf|resume|bewerb/i.test(formHtml);

  // 4. JSON-LD (JobPosting)
  let job = null;
  try {
    const ldNodes = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      const raw = $(el).contents().text();
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        ldNodes.push(parsed);
      } catch {}
    });
    function flatten(obj){ return Array.isArray(obj) ? obj : (obj && obj['@graph'] ? obj['@graph'] : [obj]); }
    const nodes = ldNodes.flatMap(flatten).filter(Boolean);
    const jp = nodes.find(n => {
      const t = (n['@type'] || n['@type'.toLowerCase()]);
      if (!t) return false;
      if (Array.isArray(t)) return t.includes('JobPosting');
      return String(t).toLowerCase() === 'jobposting';
    });
    if (jp) {
      const org = (jp.hiringOrganization && (jp.hiringOrganization.name || jp.hiringOrganization['@name'])) || jp.employer || null;
      let loc = null;
      try{
        if (jp.jobLocation && jp.jobLocation.address) loc = jp.jobLocation.address.addressLocality || jp.jobLocation.address.addressRegion || jp.jobLocation.address.addressCountry;
        if (!loc && jp.jobLocation && jp.jobLocation.address && jp.jobLocation.address.streetAddress) loc = jp.jobLocation.address.streetAddress;
      }catch{}
      job = {
        title: jp.title || jp.name || null,
        organization: org || null,
        location: loc || null,
        description: jp.description || null,
        date_posted: jp.datePosted || null,
        valid_through: jp.validThrough || null,
        apply_url: jp.hiringOrganization?.sameAs || jp.url || null
      };
    }
  } catch {}

  // 5. Extraction et filtrage des liens
  const links = $("a")
    .map((_, el) => {
      const href = $(el).attr("href");
      if (!href) return null;
      try {
        const fullUrl = new URL(href, baseUrl).href;
        // Filtrage de query tracking
        if (/utm_|fbclid=/i.test(fullUrl)) return null;
        
        // On applique la BLOCKLIST
        if (BLOCKLIST.some(bad => fullUrl.toLowerCase().includes(bad))) return null;
        
        // On reste sur le domaine d'origine
        const baseOrigin = new URL(baseUrl).origin;
        if (!fullUrl.startsWith(baseOrigin)) return null;

        return fullUrl;
      } catch {
        return null;
      }
    })
    .get()
    .filter(Boolean);

  // 6. Lien de pagination (next)
  let nextLink = null;
  try {
    const relNext = $('link[rel="next"]').attr('href');
    if (relNext) nextLink = new URL(relNext, baseUrl).href;
    if (!nextLink) {
      const NEXT_RX = /(weiter|nächste|next|more|load\s*more|vorwärts|older|page\s*\d+|»|›)/i;
      $('a').each((_, a) => {
        if (nextLink) return;
        const text = ($(a).text() || '').trim();
        if (NEXT_RX.test(text)) {
          const h = $(a).attr('href');
          if (h) {
            try { nextLink = new URL(h, baseUrl).href; } catch {}
          }
        }
      });
    }
  } catch {}

  return {
    url: baseUrl,
    text: bodyText,
    emails: emails, // Maintenant contient les emails normalisés (avec @)
    hasForm: isApplicationForm,
    links: [...new Set(links)],
    nextLink,
    job,
  };
}