/** Plex sends IETF tags (en-US) and ISO 3166 alpha-2 countries; TVDB uses 3-letter codes. */

const LANGUAGES: Record<string, string> = {
  en: 'eng', de: 'deu', fr: 'fra', es: 'spa', it: 'ita', ja: 'jpn', ko: 'kor', zh: 'zho',
  pt: 'por', ru: 'rus', nl: 'nld', sv: 'swe', no: 'nor', nb: 'nor', nn: 'nor', da: 'dan',
  fi: 'fin', pl: 'pol', cs: 'ces', hu: 'hun', tr: 'tur', he: 'heb', ar: 'ara', el: 'ell',
  th: 'tha', vi: 'vie', uk: 'ukr', id: 'ind', ro: 'ron', bg: 'bul', hr: 'hrv', sk: 'slk',
  sl: 'slv', sr: 'srp', lt: 'lit', lv: 'lav', et: 'est', fa: 'fas', hi: 'hin', ms: 'msa',
  ca: 'cat',
};

// TVDB-specific regional variants
const REGIONAL: Record<string, string> = { 'pt-br': 'pt', 'zh-tw': 'zhtw', 'zh-hk': 'yue' };

export function toTvdbLanguage(plexLanguage: string | undefined): string {
  const tag = (plexLanguage ?? 'en').toLowerCase();
  return REGIONAL[tag] ?? LANGUAGES[tag.split('-')[0]] ?? 'eng';
}

const COUNTRIES: Record<string, string> = {
  US: 'usa', GB: 'gbr', DE: 'deu', FR: 'fra', CA: 'can', AU: 'aus', NZ: 'nzl', IE: 'irl',
  NL: 'nld', ES: 'esp', IT: 'ita', JP: 'jpn', KR: 'kor', BR: 'bra', MX: 'mex', SE: 'swe',
  NO: 'nor', DK: 'dnk', FI: 'fin', AT: 'aut', CH: 'che', BE: 'bel', PT: 'prt', PL: 'pol',
  IN: 'ind', RU: 'rus',
};

export function toTvdbCountry(plexCountry: string | undefined): string | undefined {
  return COUNTRIES[(plexCountry ?? 'US').toUpperCase()];
}
