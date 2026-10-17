// IGC flight log text, the same encoding as the esp32-vario's IgcFormat.h.

export interface Fix {
  time: Date;
  lat: number;
  lon: number;
  alt: number;
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** DDMMmmm[NS] for latitude, DDDMMmmm[EW] for longitude. */
export function encodeLatLon(deg: number, isLat: boolean): string {
  const hemi = isLat ? (deg >= 0 ? 'N' : 'S') : deg >= 0 ? 'E' : 'W';
  const a = Math.abs(deg);
  let d = Math.floor(a);
  const minutes = (a - d) * 60;
  let mm = Math.floor(minutes);
  let mmm = Math.round((minutes - mm) * 1000);
  if (mmm === 1000) {
    mmm = 0;
    if (++mm === 60) { mm = 0; d++; }
  }
  return `${pad(d, isLat ? 2 : 3)}${pad(mm, 2)}${pad(mmm, 3)}${hemi}`;
}

export function formatB(f: Fix): string {
  const t = f.time;
  const alt = pad(Math.max(Math.round(f.alt), 0), 5);
  return `B${pad(t.getUTCHours(), 2)}${pad(t.getUTCMinutes(), 2)}${pad(t.getUTCSeconds(), 2)}` +
    `${encodeLatLon(f.lat, true)}${encodeLatLon(f.lon, false)}A${alt}${alt}`;
}

export function buildIgc(fixes: Fix[], site: string): string {
  const d = fixes[0]?.time ?? new Date();
  const date = `${pad(d.getUTCDate(), 2)}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCFullYear() % 100, 2)}`;
  const lines = [
    'AXXXPGSIM',
    `HFDTEDATE:${date},01`,
    'HFPLTPILOTINCHARGE:Sim pilot',
    'HFGTYGLIDERTYPE:Paraglider (simulated)',
    `HFSITSITE:${site}`,
    ...fixes.map(formatB),
  ];
  return lines.join('\r\n') + '\r\n';
}
