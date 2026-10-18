// Where the sun is, and how hard it is heating the ground. Time is local solar time (12 = the
// sun due south), so a "sunset" setting puts the sun on the horizon at every site and every date.

export interface Sun {
  /** Height above the horizon, degrees (negative after sunset). */
  elevationDeg: number;
  /** Compass bearing, degrees (90 = east). */
  azimuthDeg: number;
  /** Unit vector towards the sun: east, north, up. */
  dir: [number, number, number];
}

const RAD = Math.PI / 180;
/** Margin inside sunrise and sunset for the hours on offer: the sun ~3° up, so the scene stays lit. */
const DAYLIGHT_MARGIN_H = 0.25;
/** Hours after sunrise for the ground to warm through; until then the same sun heats less. */
const WARM_UP_H = 7;
/** Below this elevation the sun no longer drives thermals. */
const HEATING_MIN_ELEV_DEG = 10;

/** Day of the year, 1 = 1 January. */
export function dayOfYear(date: Date): number {
  return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86400000);
}

function declination(day: number): number {
  return 23.44 * RAD * Math.sin((2 * Math.PI * (284 + day)) / 365);
}

export function sunPosition(latDeg: number, day: number, hour: number): Sun {
  const phi = latDeg * RAD, d = declination(day), h = 15 * (hour - 12) * RAD;
  const e = -Math.cos(d) * Math.sin(h);
  const n = Math.sin(d) * Math.cos(phi) - Math.cos(d) * Math.sin(phi) * Math.cos(h);
  const u = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(h);
  return {
    elevationDeg: Math.asin(u) / RAD,
    azimuthDeg: ((Math.atan2(e, n) / RAD) + 360) % 360,
    dir: [e, n, u],
  };
}

/** Solar hours of sunrise and sunset (sun centre on the horizon). Polar day/night clamp to 0/24. */
export function daylight(latDeg: number, day: number): { sunrise: number; sunset: number } {
  const c = -Math.tan(latDeg * RAD) * Math.tan(declination(day));
  const h0 = Math.acos(Math.min(Math.max(c, -1), 1)) / RAD / 15;
  return { sunrise: 12 - h0, sunset: 12 + h0 };
}

/** The solar hours a flight can be set at: sunrise to sunset, short of the dark either side. */
export function flyingHours(latDeg: number, day: number): { first: number; last: number } {
  const { sunrise, sunset } = daylight(latDeg, day);
  return { first: sunrise + DAYLIGHT_MARGIN_H, last: sunset - DAYLIGHT_MARGIN_H };
}

/**
 * 0..1 — how hard the sun is driving thermals at this hour, 1 at the day's peak. The sun's
 * height times how long the ground has been warming: weak in the morning, peaking in the early
 * afternoon (the ground lags the sun), gone in the last hour or so before sunset.
 */
export function heating(latDeg: number, day: number, hour: number): number {
  const { sunrise } = daylight(latDeg, day);
  const floor = Math.sin(HEATING_MIN_ELEV_DEG * RAD);
  const drive = (h: number) =>
    Math.max(Math.sin(sunPosition(latDeg, day, h).elevationDeg * RAD) - floor, 0) * Math.min(Math.max((h - sunrise) / WARM_UP_H, 0), 1);
  let peak = 0;
  for (let h = 12; h <= 16; h += 0.05) peak = Math.max(peak, drive(h));
  return peak > 0 ? Math.min(drive(hour) / peak, 1) : 0;
}
