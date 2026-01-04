// extract.js
import { URL } from "url";

// Cette regex capture @, [at], (at), et les espaces autour pour contrer le masquage
const EMAIL_REGEX = /[A-Z0-9._%+-]+(?:\s?\[at\]\s?|\s?\(at\)\s?|@)[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const BLOCKLIST = [
  "login", "register", "anmeldung", "passwort", 
  "impressum", "datenschutz", "agb", "privacy", 
  "javascript:", "mailto:", "tel:", "#", 
  "gebaerdensprache", "leichte-sprache", "presse", "kontakt"
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

  // 4. Extraction et filtrage des liens
  const links = $("a")
    .map((_, el) => {
      const href = $(el).attr("href");
      if (!href) return null;
      try {
        const fullUrl = new URL(href, baseUrl).href;
        
        // On applique ta BLOCKLIST
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

  return {
    url: baseUrl,
    text: bodyText,
    emails: emails, // Maintenant contient les emails normalisés (avec @)
    hasForm: isApplicationForm,
    links: [...new Set(links)],
  };
}