import type { ApiContact } from '../api';

/**
 * Lead source ("Contact source" in the contact panel) auto-detection.
 *
 * Manual contacts pick a source from the dropdown. Leads that come through a
 * public form carry no source at all, so it is detected from where the visitor
 * actually came: the referrer the browser reports when the form link is opened
 * from an ad. Adding a form link to a Facebook / Instagram / Google campaign is
 * therefore enough — no per-form configuration.
 */

export const CONTACT_SOURCES = [
  'Website',
  'Facebook',
  'Instagram',
  'TikTok',
  'Google',
  'Referral',
  'Walk-In',
  'Phone Call',
  'Email',
  'SMS',
  'WhatsApp',
  'Event',
  'Other',
] as const;

/**
 * Referrer host fragment -> source. Ordered so the more specific ad/redirect
 * hosts are tested before the bare apex domains they sit under. "Mail" hosts
 * are checked before Google so a link shared from a mailbox reads as Email.
 */
const REFERRER_PATTERNS: readonly [RegExp, string][] = [
  [/\bfacebook\.com\b|\bfb\.com\b|\bfb\.gg\b|\batdmt\.com\b|\bmessenger\.com\b/i, 'Facebook'],
  [/\binstagram\.com\b/i, 'Instagram'],
  [/\btiktok\.com\b|\btiktokcdn\.com\b/i, 'TikTok'],
  [/\bmail\.(google|outlook|hotmail|ymail|yahoo)\.com\b/i, 'Email'],
  [/\bgoogleadservices\.com\b|\bdoubleclick\.net\b|\bgooglesyndication\.com\b|\bgoogle\.[a-z.]{2,}\b/i, 'Google'],
  [/\byoutube\.com\b|\byoutu\.be\b|\bytimg\.com\b/i, 'Google'],
  [/\bbing\.com\b/i, 'Google'],
  [/\blinkedin\.com\b|\blnkd\.in\b/i, 'LinkedIn'],
  [/\bwa\.me\b|\bwhatsapp\.com\b/i, 'WhatsApp'],
  [/\bt\.me\b|\btelegram\.(me|org)\b/i, 'Telegram'],
  [/\btwitter\.com\b|\bx\.com\b|\bt\.co\b/i, 'X (Twitter)'],
  [/\byadea\.(com|pk)\b|\bbiztrack\.uk\b/i, 'Website'],
];

/**
 * Whole-value matches for a utm_source parameter. Ads are configured with short
 * codes ("fb", "ig", "tt"), so these are anchored rather than substring-matched
 * to keep "big"/"li"-style words from landing on the wrong platform.
 */
const UTM_PATTERNS: readonly [RegExp, string][] = [
  [/^(fb|facebook|meta|messenger|meta_ads|facebook_ads)$/i, 'Facebook'],
  [/^(ig|instagram|meta_ig)$/i, 'Instagram'],
  [/^(tt|tiktok|tik_?tok)$/i, 'TikTok'],
  [/^(google|adwords|google_?ads|googlesyndication|bing|youtube|yt|gdn)$/i, 'Google'],
  [/^(li|linkedin|linkedin_?ads)$/i, 'LinkedIn'],
  [/^(wa|whatsapp|whatsapp_?ads)$/i, 'WhatsApp'],
  [/^(tg|telegram)$/i, 'Telegram'],
  [/^(x|twitter|twitter_?ads)$/i, 'X (Twitter)'],
  [/^(e?mail|e?mail_?campaign|newsletter)$/i, 'Email'],
  [/^(website|web|site|landing_?page)$/i, 'Website'],
];

/** Keywords used when there is no usable referrer (privacy stripping, shared links). */
const NAME_PATTERNS: readonly [RegExp, string][] = [
  [/\bfacebook\b|\bfb\b|meta ads|meta_ads/i, 'Facebook'],
  [/\binstagram\b|\big\b/i, 'Instagram'],
  [/\btiktok\b|tik tok/i, 'TikTok'],
  [/google|adwords|google ?ads|\bbing\b|\bseo\b/i, 'Google'],
  [/linkedin|\bli\b/i, 'LinkedIn'],
  [/whatsapp|\bwa\b/i, 'WhatsApp'],
  [/telegram|\btg\b/i, 'Telegram'],
  [/youtube/i, 'Google'],
  [/website|landing ?page|\bweb\b|contact ?us|enquir/i, 'Website'],
  [/walk.?in|showroom|store visit/i, 'Walk-In'],
  [/referral|refer\b/i, 'Referral'],
  [/event|expo|roadshow/i, 'Event'],
];

function match(url: string, patterns: readonly [RegExp, string][]): string {
  if (!url) return '';
  for (const [re, source] of patterns) {
    if (re.test(url)) return source;
  }
  return '';
}

/** Map a referrer URL (or the current page URL) to a lead source. */
export function sourceFromUrl(url: string): string {
  return match(url ?? '', REFERRER_PATTERNS);
}

/** Read `utm_source`/`utm_medium` off a URL's query string (ads usually carry these). */
export function sourceFromUtm(search: string): string {
  if (!search) return '';
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return '';
  }
  for (const key of ['utm_source', 'utm_medium']) {
    const raw = (params.get(key) ?? '').trim();
    if (!raw) continue;
    const low = raw.toLowerCase();
    // "organic"/"referral" carry no platform information — let the referrer
    // and the form name decide instead of claiming them here.
    if (low === 'organic') continue;
    for (const [re, source] of UTM_PATTERNS) {
      if (re.test(raw)) return source;
    }
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  return '';
}

/**
 * Work out the source of a visit to a public form: the referrer the browser
 * reported wins, then any utm parameter, then the form/campaign name.
 *
 * A referrer pointing at our own origin is ignored — that is staff previewing
 * the form inside the CRM, not a lead arriving from an ad.
 */
export function detectFormSource(opts: {
  referrer?: string;
  search?: string;
  formName?: string;
  campaignName?: string;
}): string {
  const referrer = opts.referrer ?? '';
  const host = hostOf(referrer);
  const sameOrigin = host !== '' && host === currentHost();
  return (
    (sameOrigin ? '' : sourceFromUrl(referrer)) ||
    sourceFromUtm(opts.search ?? '') ||
    match(`${opts.formName ?? ''} ${opts.campaignName ?? ''}`, NAME_PATTERNS)
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function currentHost(): string {
  if (typeof window === 'undefined') return '';
  return window.location.hostname.toLowerCase();
}

export interface ResolvedContactSource {
  /** Value to show/save, '' when nothing could be determined. */
  value: string;
  /** True when the value was derived rather than already stored on the contact. */
  auto: boolean;
  /** Form the value was derived from, when applicable. */
  fromForm?: string;
}

interface RawSubmission {
  formName?: unknown;
  source?: unknown;
}

/**
 * The contact's source: whatever was saved on the contact, otherwise derived
 * from the form submissions it arrived through. Deriving at read time means
 * leads captured before this existed also show a source, with no backfill.
 */
export function resolveContactSource(
  customFields?: Record<string, unknown> | null
): ResolvedContactSource {
  const stored = customFields?.['source'];
  if (typeof stored === 'string' && stored.trim()) {
    return { value: stored.trim(), auto: false };
  }

  const raw = customFields?.['form_submissions'];
  if (Array.isArray(raw)) {
    const subs = raw.filter(
      (s): s is RawSubmission => !!s && typeof s === 'object'
    );
    // Newest submission wins — it is the most recent thing the lead did.
    for (let i = subs.length - 1; i >= 0; i--) {
      const sub = subs[i];
      const name = typeof sub.formName === 'string' ? sub.formName : '';
      const fromSubmission = typeof sub.source === 'string' ? sub.source.trim() : '';
      const hit = fromSubmission || match(name, NAME_PATTERNS);
      if (hit) return { value: hit, auto: true, fromForm: name || undefined };
    }
  }

  return { value: '', auto: false };
}

/** Convenience wrapper for the contact list column. */
export function contactSourceOf(contact: ApiContact): string {
  return resolveContactSource(contact.custom_fields).value;
}