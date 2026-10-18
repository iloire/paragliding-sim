// Downloads the open IGN data for a site and writes the files the game loads:
//   height.bin — Int16 little-endian, decimetres, row 0 = north edge, sea = SEA_LEVEL_DM
//   ortho.jpg  — PNOA orthophoto over exactly the same bbox
//   detail/    — the same pair at the DEM's native 5 m (and a sharper photo) for the
//                square tiles near the launches, plus tiles.json listing them
// Usage: npm run fetch-terrain -- lanzarote            (everything)
//        npm run fetch-terrain -- lanzarote --detail   (detail tiles only)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromArrayBuffer } from 'geotiff';
import proj4 from 'proj4';

const WCS = 'https://servicios.idee.es/wcs-inspire/mdt';
const WMS = 'https://www.ign.es/wms-inspire/pnoa-ma';
const NODATA = -32768;
const SEA_LEVEL_DM = -150; // sea floor 15 m below the water plane, so the coastline reads clearly
const DEM_RES = 5; // MDT05 native resolution (m)
/** A detail tile needs at least this much land to be worth fetching. */
const MIN_LAND = 0.01;

interface SiteFile {
  proj4: string;
  crs: string;
  bbox: [number, number, number, number];
  heightmap: { file: string; size: number };
  ortho: { file: string; size: number };
  launches: { lat: number; lon: number }[];
  detail?: { dir: string; tileM: number; orthoSize: number; radiusM: number };
}

async function download(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.arrayBuffer();
}

// The WCS returns whole metres; a 3×3 box blur removes the 1 m terracing on gentle slopes.
function smooth(src: Float32Array, n: number, isSea: Uint8Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (isSea[i]) { out[i] = src[i]; continue; }
      let sum = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
          const j = yy * n + xx;
          if (isSea[j]) continue;
          sum += src[j]; count++;
        }
      }
      out[i] = sum / count;
    }
  }
  return out;
}

/**
 * DEM over a square, as game-ready Int16 decimetres. `n` samples a side; omitting it takes
 * the native 5 m grid with a one-pixel margin that is cropped after smoothing, so
 * neighbouring tiles blur across their shared edge identically.
 */
async function fetchDem(epsg: string, x0: number, y0: number, x1: number, y1: number, n?: number): Promise<Int16Array> {
  const m = n === undefined ? DEM_RES : 0;
  let url = `${WCS}?SERVICE=WCS&REQUEST=GetCoverage&VERSION=2.0.1&CoverageId=Elevacion${epsg}_5` +
    `&FORMAT=image/tiff&SUBSET=x(${x0 - m},${x1 + m})&SUBSET=y(${y0 - m},${y1 + m})`;
  if (n !== undefined) url += `&SCALESIZE=x(${n}),y(${n})`;
  const image = await (await fromArrayBuffer(await download(url))).getImage();
  const w = image.getWidth();
  if (image.getHeight() !== w) throw new Error(`expected a square DEM, got ${w}×${image.getHeight()}`);
  const [raster] = (await image.readRasters()) as unknown as [ArrayLike<number>];
  const raw = new Float32Array(w * w);
  const isSea = new Uint8Array(w * w);
  for (let i = 0; i < w * w; i++) {
    const v = raster[i];
    // Some IGN tiles store open sea as 0 m rather than nodata.
    if (v === NODATA || v <= 0) { isSea[i] = 1; raw[i] = SEA_LEVEL_DM / 10; } else raw[i] = v;
  }
  const height = smooth(raw, w, isSea);
  const crop = m ? 1 : 0;
  const size = w - 2 * crop;
  const out = new Int16Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const i = (r + crop) * w + c + crop;
      out[r * size + c] = isSea[i] ? SEA_LEVEL_DM : Math.round(height[i] * 10);
    }
  }
  return out;
}

async function fetchOrtho(crs: string, x0: number, y0: number, x1: number, y1: number, size: number): Promise<Buffer> {
  const url = `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=OI.OrthoimageCoverage&STYLES=` +
    `&CRS=${crs}&BBOX=${x0},${y0},${x1},${y1}&WIDTH=${size}&HEIGHT=${size}&FORMAT=image/jpeg`;
  return Buffer.from(await download(url));
}

/** Tiles (col from the west, row from the south) with land, within radiusM of a launch. */
function pickTiles(site: SiteFile, base: Int16Array): [number, number][] {
  const detail = site.detail!;
  const [x0, y0, x1] = site.bbox;
  const extent = x1 - x0, n = site.heightmap.size, px = extent / n;
  const proj = proj4('EPSG:4326', site.proj4);
  const launches = site.launches.map((l) => {
    const [e, nn] = proj.forward([l.lon, l.lat]);
    return [e - x0, nn - y0];
  });
  const tiles: [number, number][] = [];
  const count = Math.round(extent / detail.tileM);
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      const cx = (col + 0.5) * detail.tileM, cy = (row + 0.5) * detail.tileM;
      const near = launches.some(([lx, ly]) => Math.max(Math.abs(lx - cx), Math.abs(ly - cy)) <= detail.radiusM);
      if (!near) continue;
      let land = 0, total = 0;
      for (let y = row * detail.tileM; y < (row + 1) * detail.tileM; y += px) {
        for (let x = col * detail.tileM; x < (col + 1) * detail.tileM; x += px) {
          const r = Math.min(Math.floor((extent - y) / px), n - 1), c = Math.floor(x / px);
          total++;
          if (base[r * n + c] > 50) land++;
        }
      }
      if (land / total >= MIN_LAND) tiles.push([col, row]);
    }
  }
  return tiles;
}

async function main(): Promise<void> {
  const siteId = process.argv[2] ?? 'lanzarote';
  const detailOnly = process.argv.includes('--detail');
  const dir = join('public', 'sites', siteId);
  const site = JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8')) as SiteFile;
  const [x0, y0, x1, y1] = site.bbox;
  const epsg = site.crs.split(':')[1];
  const heightFile = join(dir, site.heightmap.file);

  if (!detailOnly) {
    const n = site.heightmap.size;
    console.log(`DEM ${n}×${n} from IGN MDT05 …`);
    const dem = await fetchDem(epsg, x0, y0, x1, y1, n);
    writeFileSync(heightFile, Buffer.from(dem.buffer));
    console.log(`Ortho ${site.ortho.size}² from PNOA …`);
    writeFileSync(join(dir, site.ortho.file), await fetchOrtho(site.crs, x0, y0, x1, y1, site.ortho.size));
    let max = 0, sea = 0;
    for (const v of dem) { max = Math.max(max, v / 10); if (v === SEA_LEVEL_DM) sea++; }
    console.log(`Base done: max elevation ${max.toFixed(0)} m, sea cells ${((sea / dem.length) * 100).toFixed(0)}%`);
  }

  if (!site.detail) return;
  const { tileM, orthoSize } = site.detail;
  const detailDir = join(dir, site.detail.dir);
  mkdirSync(detailDir, { recursive: true });
  const base = new Int16Array(readFileSync(heightFile).buffer.slice(0));
  const tiles = pickTiles(site, base);
  console.log(`${tiles.length} detail tiles of ${tileM / 1000} km at ${DEM_RES} m …`);
  for (const [col, row] of tiles) {
    const tx0 = x0 + col * tileM, ty0 = y0 + row * tileM;
    const dem = await fetchDem(epsg, tx0, ty0, tx0 + tileM, ty0 + tileM);
    writeFileSync(join(detailDir, `${col}_${row}.bin`), Buffer.from(dem.buffer));
    writeFileSync(join(detailDir, `${col}_${row}.jpg`), await fetchOrtho(site.crs, tx0, ty0, tx0 + tileM, ty0 + tileM, orthoSize));
    process.stdout.write('.');
  }
  writeFileSync(join(detailDir, 'tiles.json'), JSON.stringify({ size: tileM / DEM_RES, tiles }) + '\n');
  console.log('\nDetail done');
}

main().catch((err) => { console.error(err); process.exit(1); });
