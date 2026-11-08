export type SourceQuality = 'primary' | 'secondary' | 'unrated';

export interface QualityRating {
  quality: SourceQuality;
  reason: string;
}

/** Official bodies and primary-data publishers (matched on the registered domain or any subdomain of it). */
const PRIMARY_DOMAINS = [
  'who.int', 'un.org', 'europa.eu', 'worldbank.org', 'imf.org', 'oecd.org', 'wto.org', 'bis.org', 'ecb.europa.eu',
  'nih.gov', 'cdc.gov', 'nasa.gov', 'noaa.gov', 'sec.gov', 'census.gov', 'bls.gov', 'federalreserve.gov', 'data.gov',
  'ons.gov.uk', 'gov.uk', 'parliament.uk', 'legislation.gov.uk', 'supremecourt.gov', 'congress.gov', 'esa.int', 'cern.ch',
  'arxiv.org', 'pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov', 'doi.org', 'iso.org', 'ietf.org', 'w3.org', 'rfc-editor.org',
];

/** Established news, reference and journal publishers. */
const SECONDARY_DOMAINS = [
  'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com', 'wsj.com', 'ft.com', 'economist.com', 'theguardian.com',
  'washingtonpost.com', 'bloomberg.com', 'npr.org', 'nature.com', 'science.org', 'sciencedirect.com', 'springer.com',
  'wiley.com', 'thelancet.com', 'nejm.org', 'bmj.com', 'cell.com', 'pnas.org', 'britannica.com', 'wikipedia.org',
  'scientificamerican.com', 'newscientist.com', 'hbr.org', 'mckinsey.com', 'statista.com', 'pewresearch.org',
];

const matches = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

/** Rate a source from its address alone. "unrated" means "not on the recognised lists", not "bad". */
export function rateSource(url: string): QualityRating {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase().replace(/\.+$/, ''); } catch { return { quality: 'unrated', reason: 'Not a valid address' }; }
  const labels = host.split('.');
  const tld = labels.at(-1) ?? '';
  const second = labels.at(-2) ?? '';
  if (tld === 'gov' || tld === 'mil' || tld === 'edu' || tld === 'int' || (labels.length >= 3 && tld.length === 2 && (second === 'gov' || second === 'ac' || second === 'edu' || second === 'mil'))) {
    return { quality: 'primary', reason: `Official government, military, academic or intergovernmental domain (${host})` };
  }
  const primary = PRIMARY_DOMAINS.find((d) => matches(host, d));
  if (primary) return { quality: 'primary', reason: `Official or primary-data publisher (${primary})` };
  const secondary = SECONDARY_DOMAINS.find((d) => matches(host, d));
  if (secondary) return { quality: 'secondary', reason: `Established news, journal or reference publisher (${secondary})` };
  return { quality: 'unrated', reason: `${host} is not on the recognised lists` };
}

/** Whole days between a declared publication date and `now`, or null if the date cannot be read. */
export function ageInDays(publishedAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!publishedAt) return null;
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}
