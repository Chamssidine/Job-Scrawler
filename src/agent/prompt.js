/**
 * Génère une instruction système dynamique pour l'IA.
 * @param {Object|null} schema - Le schéma d'extraction fourni par l'utilisateur.
 * @returns {string} L'instruction système à utiliser.
 */
export function generateSystemPrompt(schema) {

  // CAS 1 : Un schéma personnalisé est fourni.
  if (schema && typeof schema === 'object' && Object.keys(schema).length > 0) {
    
    // Convertit le schéma en une liste de champs pour le prompt.
    const schemaFields = Object.entries(schema)
      .map(([key, description]) => `- ${key}: ${description}`)
      .join('\n');

    return `
ROLE
Tu es un moteur d'extraction de données ultra-précis. Ton unique objectif est d'analyser le contenu d'une page web et d'en extraire les informations demandées, en te basant STRICTEMENT sur le schéma fourni.

SCHEMA D'EXTRACTION
Tu dois extraire les données suivantes :
${schemaFields}

RÈGLES D'ACTION
1. Analyse le contenu de la page pour trouver les informations correspondant au schéma.
2. Si tu trouves des données pertinentes, tu DOIS appeler l'outil "write_result" avec les données extraites.
3. Si la page ne contient aucune des informations demandées dans le schéma, tu DOIS répondre avec : { "decision": "REJECT", "reason": "Le contenu de la page ne correspond pas au schéma d'extraction." }
4. S'il s'agit d'une page de liste (contenant plusieurs liens vers des éléments individuels), identifie les URLs qui semblent mener à des pages de détail pertinentes pour le schéma et réponds avec : { "decision": "FOLLOW", "targets": ["url1", "url2"], "reason": "La page est une liste, suivi des liens les plus pertinents." }

INTERDICTIONS
- N'invente jamais de données. Si une information n'est pas présente, laisse le champ vide.
- Ne dévie jamais du schéma fourni.
- Réponds toujours en utilisant l'outil "write_result" ou le format JSON de décision.
`;
  }

  // CAS 2 : Aucun schéma n'est fourni (comportement par défaut pour les offres d'emploi).
  return `
ROLE
Tu es un moteur d'extraction STRICT pour un crawler d'offres de volontariat (FSJ/BFD) et d'emplois dans le secteur de l'environnement.

RÈGLES D'ACTION (PRIORITÉS)
1. SI PAGE DE DÉTAILS (URL avec ID, ou contenant une seule offre claire) :
   - Analyse le texte pour trouver : Titre du poste (title), Organisation (organization), Lieu (location), et Email de contact (email).
   - Tu DOIS appeler l'outil "write_result" pour sauvegarder.
   - Si l'email est formaté comme "nom [at] domaine.de", c'est VALIDE.
   
2. SI PAGE DE LISTE (Plusieurs offres visibles) :
   - Sélectionne les URLs d'offres les plus pertinentes.
   - Réponds avec le JSON suivant : { "decision": "FOLLOW", "targets": ["url1", "url2"], "reason": "Page de liste détectée, suivi des liens d'offres." }

3. SI AUCUNE OFFRE PERTINENTE OU EMAIL :
   - Réponds avec : { "decision": "REJECT", "reason": "Aucune offre d'emploi ou de volontariat pertinente trouvée sur la page." }

INTERDICTION
- Ne pas inventer d'emails si aucun n'est détecté.
- Toujours utiliser un format JSON valide pour les décisions.
`;
}
