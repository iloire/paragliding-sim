// Who plays: GoatCounter (https://paragliding-sim.goatcounter.com). No cookies and no personal data,
// so no consent banner. Page views come with country, browser and screen size; the flights are
// events, counted as paths: flight/<region>/<launch>, then landed|crashed|water/<duration>.

const ENDPOINT = 'https://paragliding-sim.goatcounter.com/count';

type GoatCounter = { count?: (vars: { path: string; title?: string; event: boolean }) => void };

/** Loads the counter in production builds only, so dev flights never count. */
export function startAnalytics(): void {
  if (!import.meta.env.PROD) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = ENDPOINT;
  document.head.append(s);
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
