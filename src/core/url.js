export function normalizeUrl(raw) {
  try {
    if (typeof raw !== 'string') return '';
    let s = raw.trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      s = s.slice(1, -1);
    }

    const u = new URL(s);
    // Lowercase protocol and hostname
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();

    // Remove default ports
    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
      u.port = '';
    }

    // Remove tracking params and common noise
    const toDelete = [
      'utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid','msclkid',
      'cHash','tx_bafzacookiebar_pi1[accepted]','tx_bafzacookiebar_pi1[action]','tx_bafzacookiebar_pi1[controller]','tx_bafzacookiebar_pi1[storage]','type'
    ];
    for (const k of toDelete) u.searchParams.delete(k);

    // Sort query params deterministically
    if ([...u.searchParams.keys()].length > 0) {
      const entries = [...u.searchParams.entries()].sort(([a],[b]) => a.localeCompare(b));
      u.search = '';
      for (const [k,v] of entries) if (v !== '') u.searchParams.append(k, v);
    }

    // Collapse duplicate slashes in pathname
    u.pathname = u.pathname.replace(/\/+/g,'/');
    // Remove trailing slash (except root)
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0,-1);

    return u.toString();
  } catch {
    return (typeof raw === 'string') ? raw.trim().replace(/^['"]|['"]$/g,'') : '';
  }
}
