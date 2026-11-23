const ADULT_PATTERNS: RegExp[] = [
  /(?:^|[\s._/|\-[\]():,])\+?18\+?(?:$|[\s._/|\-[\]():,])/i,
  /(?:^|[\s._/|\-[\]():,])(xxx|nsfw|erotik|erotic|erotica|yetiskin|yetişkin|adult|adults|hentai|porn|porno|pornhub|xvideos|xnxx|redtube|youporn|xhamster|brazzers|bangbros|chaturbate|onlyfans|playboy|hustler|penthouse|dorcel|babestation|vivid|hardcore|softcore|camgirl|sexmex|nudity|stripclub|fetish|milf|redlight|beate\s*uhse|blue\s*movie|lust\s*pur|blue\s*hustler|venus\s*tv|private\s*tv|man-x)(?:$|[\s._/|\-[\]():,])/i,
  /(?:^|[\s._/|\-[\]():,])(sex|sexy|nude)(?:$|[\s._/|\-[\]():,])/i,
  /\bfor\s+adults?\b/i,
  /\badult\s*(only|tv|channel|channels|xxx|movie|movies|vod)\b/i,
  /\byeti[sş]kin\s*(yay[ıi]n|kanal|film|içerik|icerik)\b/i,
];

export function isAdultContent(
  name: string,
  group?: string | null,
  url?: string | null,
  tags?: string | null
): boolean {
  const combined = `${name || ''} | ${group || ''} | ${url || ''} | ${tags || ''}`;
  if (!combined.trim()) return false;
  return ADULT_PATTERNS.some((pattern) => pattern.test(combined));
}
