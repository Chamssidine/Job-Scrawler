export const MAX_DEPTH = 2;
export const MAX_PAGES = 10;

export function canFollow(url, state) {
  if (state.visited.has(url)) return false;
  if (state.visited.size >= MAX_PAGES) return false;
  return true;
}
// guards.js
const BLACKLIST = [
  'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com',
  'impressum', 'datenschutz', 'privacy', 'cookie-policy',
  'gebaerdensprache', 'leichte-sprache', 'presse', 'contact',
  '.pdf', '.jpg', '.png'
];

export function isBullshitUrl(url) {
  const lowercaseUrl = url.toLowerCase();
  // Si l'URL contient un mot de la blacklist, on dégage
  return BLACKLIST.some(term => lowercaseUrl.includes(term));
}