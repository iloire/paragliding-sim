// Loads a site folder from public/sites/<id>/ and converts between lat/lon and the
// local frame (x east, y north, metres from the bbox's south-west corner).

import proj4 from 'proj4';
import type { Weather } from '../sim/wind';
import { Heightmap } from '../sim/terrain';

export interface LaunchSpec {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Compass heading the launch faces; omitted = steepest descent from the DEM. */
  headingDeg?: number;
}

export interface SiteSpec {
  name: string;
  proj4: string;
  crs: string;
  bbox: [number, number, number, number];
  heightmap: { file: string; size: number };
  ortho: { file: string; size: number };
  launches: LaunchSpec[];
  weather: Weather;
}

export interface Launch {
  spec: LaunchSpec;
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface Site {
  spec: SiteSpec;
  terrain: Heightmap;
  orthoUrl: string;
  launches: Launch[];
  toLatLon(x: number, y: number): [number, number];
}

export async function loadSite(id: string): Promise<Site> {
  const base = `${import.meta.env.BASE_URL}sites/${id}/`;
  const spec = (await (await fetch(`${base}site.json`)).json()) as SiteSpec;
  const buffer = await (await fetch(`${base}${spec.heightmap.file}`)).arrayBuffer();
  const [x0, y0, x1] = spec.bbox;
  const terrain = Heightmap.fromInt16Dm(buffer, spec.heightmap.size, x1 - x0);
  const proj = proj4('EPSG:4326', spec.proj4);

  const launches = spec.launches.map((l): Launch => {
    const [e, n] = proj.forward([l.lon, l.lat]);
    const x = e - x0, y = n - y0;
    const heading = l.headingDeg !== undefined ? (l.headingDeg * Math.PI) / 180 : terrain.downhillHeading(x, y);
    return { spec: l, x, y, z: terrain.groundAt(x, y), heading };
  });

  return {
    spec,
    terrain,
    orthoUrl: `${base}${spec.ortho.file}`,
    launches,
    toLatLon(x, y) {
      const [lon, lat] = proj.inverse([x + x0, y + y0]);
      return [lat, lon];
    },
  };
}
