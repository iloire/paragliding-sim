// Who plays: GoatCounter (https://paragliding-sim.goatcounter.com). No cookies and no personal data,
// so no consent banner. Page views come with country, browser and screen size; the flights are
// events, counted as paths: flight/<region>/<launch>, then landed|crashed|water/<duration>.

const ENDPOINT = 'https://paragliding-sim.goatcounter.com/count';

type GoatCounter = { count?: (vars: { path: string; title?: string; event: boolean }) => void };

/** Loads the counter in production builds only, so dev flights never count. */
export function startAnalytics(): void {
  startGA();
  if (!import.meta.env.PROD) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = ENDPOINT;
  document.head.append(s);
}

// Google Analytics 4 as well, only when the build has a measurement ID (VITE_GA_ID; CI sets it from the
// GA_MEASUREMENT_ID repo variable). Consent Mode starts every storage denied; a one-line chip asks once
// and the answer is kept per browser. GoatCounter above counts everyone either way.

declare global {
  interface Window { dataLayer: unknown[] }
}

const GA_ID: string = import.meta.env.VITE_GA_ID ?? '';
const CONSENT_KEY = 'famara-glide.stats';

// gtag.js reads the Arguments object itself, not an array; the rest parameter is only there for the types.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function gtag(..._args: unknown[]): void {
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments);
}

function readConsent(): string | null {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

function grant(on: boolean): void {
  try {
    localStorage.setItem(CONSENT_KEY, on ? 'yes' : 'no');
  } catch { /* private window: asked again next visit */ }
  gtag('consent', 'update', { analytics_storage: on ? 'granted' : 'denied' });
}

/** The chip: one line, bottom-right above the credits, gone after either answer. */
function askOnce(): void {
  const chip = document.createElement('div');
  chip.id = 'stats-chip';
  chip.innerHTML = 'Anonymous play stats? <button type="button" data-on>OK</button><button type="button">No</button>';
  chip.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    grant(b.hasAttribute('data-on'));
    chip.remove();
  });
  document.body.append(chip);
}

function startGA(): void {
  if (!GA_ID) return;
  window.dataLayer = window.dataLayer || [];
  const consent = readConsent();
  gtag('consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    analytics_storage: consent === 'yes' ? 'granted' : 'denied',
  });
  gtag('js', new Date());
  gtag('config', GA_ID);
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.append(s);
  if (!consent) askOnce();
}

/** A GA event with its parameters; a no-op without a measurement ID. */
export function gaEvent(name: string, params: Record<string, string | number | boolean> = {}): void {
  if (GA_ID) gtag('event', name, params);
}

export function track(path: string, title?: string): void {
  // Before count.js arrives there is nothing to call; losing the odd early event is fine.
  (window as { goatcounter?: GoatCounter }).goatcounter?.count?.({ path, title, event: true });
}

/** Coarse flight-length buckets, so the dashboard groups flights instead of listing every second. */
export function durationBucket(seconds: number): string {
  if (seconds < 30) return 'under-30s';
  if (seconds < 120) return '30s-2min';
  if (seconds < 600) return '2-10min';
  if (seconds < 1800) return '10-30min';
  return '30min-plus';
}
