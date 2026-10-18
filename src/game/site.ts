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

export interface LandingSpec {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface SiteSpec {
  name: string;
  proj4: string;
  crs: string;
  bbox: [number, number, number, number];
  heightmap: { file: string; size: number };
  ortho: { file: string; size: number };
  /** Native-resolution tiles near the launches, written by scripts/fetch-terrain.ts. */
  detail?: { dir: string; tileM: number; orthoSize: number; radiusM: number };
  launches: LaunchSpec[];
  /** Official landing fields, for the HUD's glide-to-landing readout. */
  landings?: LandingSpec[];
  weather: Weather;
}

export interface Launch {
  spec: LaunchSpec;
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface Landing {
  spec: LandingSpec;
  x: number;
  y: number;
  z: number;
}

export interface DetailTile {
  col: number;
  row: number;
  orthoUrl: string;
}

export interface Site {
  spec: SiteSpec;
  terrain: Heightmap;
  orthoUrl: string;
  /** Square tile size of the detail grid (m), 0 when the site has none. */
  detailTileM: number;
  detailTiles: DetailTile[];
  launches: Launch[];
  landings: Landing[];
  toLatLon(x: number, y: number): [number, number];
}

export async function loadSite(id: string): Promise<Site> {
  const base = `${import.meta.env.BASE_URL}sites/${id}/`;
  const spec = (await (await fetch(`${base}site.json`)).json()) as SiteSpec;
  const buffer = await (await fetch(`${base}${spec.heightmap.file}`)).arrayBuffer();
  const [x0, y0, x1] = spec.bbox;
  const terrain = Heightmap.fromInt16Dm(buffer, spec.heightmap.size, x1 - x0);
  const detailTiles = spec.detail ? await loadDetail(terrain, `${base}${spec.detail.dir}/`, spec.detail.tileM) : [];
  const proj = proj4('EPSG:4326', spec.proj4);

  const launches = spec.launches.map((l): Launch => {
    const [e, n] = proj.forward([l.lon, l.lat]);
    const x = e - x0, y = n - y0;
    const heading = l.headingDeg !== undefined ? (l.headingDeg * Math.PI) / 180 : terrain.downhillHeading(x, y);
    return { spec: l, x, y, z: terrain.groundAt(x, y), heading };
  });

  const landings = (spec.landings ?? []).map((l): Landing => {
    const [e, n] = proj.forward([l.lon, l.lat]);
    const x = e - x0, y = n - y0;
    return { spec: l, x, y, z: terrain.groundAt(x, y) };
  });

  return {
    spec,
    terrain,
    orthoUrl: `${base}${spec.ortho.file}`,
    detailTileM: spec.detail?.tileM ?? 0,
    detailTiles,
    launches,
    landings,
    toLatLon(x, y) {
      const [lon, lat] = proj.inverse([x + x0, y + y0]);
      return [lat, lon];
    },
  };
}

/** Fetches every detail heightmap up front (they are small) so physics always has them. */
async function loadDetail(terrain: Heightmap, dir: string, tileM: number): Promise<DetailTile[]> {
  const index = (await (await fetch(`${dir}tiles.json`)).json()) as { size: number; tiles: [number, number][] };
  return Promise.all(index.tiles.map(async ([col, row]): Promise<DetailTile> => {
    const buffer = await (await fetch(`${dir}${col}_${row}.bin`)).arrayBuffer();
    terrain.addDetail(tileM, col, row, Heightmap.fromInt16Dm(buffer, index.size, tileM, col * tileM, row * tileM));
    return { col, row, orthoUrl: `${dir}${col}_${row}.jpg` };
  }));
}
