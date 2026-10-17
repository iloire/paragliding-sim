// Synthetic terrain for tests: sea to the south, a 400 m cliff facing south at
// y = 2000–2400, a plateau, then the ground drops away again at y = 4000–4400.
import { Heightmap } from './terrain';
import type { Weather } from './wind';

export const EXTENT = 6000;

export function cliffTerrain(): Heightmap {
  return Heightmap.fromFunction(256, EXTENT, (_x, y) => {
    if (y < 2000) return -15;
    if (y < 2400) return ((y - 2000) / 400) * 400;
    if (y < 4000) return 400;
    if (y < 4400) return 400 - ((y - 4000) / 400) * 300;
    return 100;
  });
}

export function calmWeather(over: Partial<Weather> = {}): Weather {
  return { windSpeedKmh: 0, windFromDeg: 180, inversionM: 3000, thermalStrength: 0, turbulence: 0, ...over };
}
