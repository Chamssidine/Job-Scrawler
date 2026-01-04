export default  function computeScore(page) {
  let score = 0;
  const reasons = [];

  if (page.emails.length > 0) {
    score += 30;
    reasons.push("Email de candidature détecté");
  }

  if (!page.hasForm) {
    score += 20;
    reasons.push("Aucun formulaire de candidature");
  }

  if (/international|foreign applicants|from abroad|outside germany/i.test(page.text)) {
    score += 25;
    reasons.push("Ouverture aux candidats internationaux");
  }

  if (!/only germany|nur.*deutschland|german residence|required in germany/i.test(page.text)) {
    score += 15;
    reasons.push("Aucune restriction géographique détectée");
  }

  if (/\.(edu|ac|org)/i.test(page.url)) {
    score += 10;
    reasons.push("Source institutionnelle");
  }

  return { score, reasons };
}
