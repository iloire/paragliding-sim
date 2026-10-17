// Downloads the open IGN data for a site and writes the files the game loads:
//   height.bin — Int16 little-endian, decimetres, row 0 = north edge, sea = SEA_LEVEL_DM
//   ortho.jpg  — PNOA orthophoto over exactly the same bbox
// Usage: npm run fetch-terrain -- famara
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromArrayBuffer } from 'geotiff';

const WCS = 'https://servicios.idee.es/wcs-inspire/mdt';
const WMS = 'https://www.ign.es/wms-inspire/pnoa-ma';
const NODATA = -32768;
const SEA_LEVEL_DM = -150; // sea floor 15 m below the water plane, so the coastline reads clearly

interface SiteFile {
  crs: string;
  bbox: [number, number, number, number];
  heightmap: { file: string; size: number };
  ortho: { file: string; size: number };
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

async function main(): Promise<void> {
  const siteId = process.argv[2] ?? 'famara';
  const dir = join('public', 'sites', siteId);
  const site = JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8')) as SiteFile;
  const [x0, y0, x1, y1] = site.bbox;
  const epsg = site.crs.split(':')[1];
  const n = site.heightmap.size;

  console.log(`DEM ${n}×${n} from IGN MDT05 …`);
  const demUrl = `${WCS}?SERVICE=WCS&REQUEST=GetCoverage&VERSION=2.0.1&CoverageId=Elevacion${epsg}_5` +
    `&FORMAT=image/tiff&SUBSET=x(${x0},${x1})&SUBSET=y(${y0},${y1})&SCALESIZE=x(${n}),y(${n})`;
  const tiff = await fromArrayBuffer(await download(demUrl));
  const image = await tiff.getImage();
  const [raster] = (await image.readRasters()) as unknown as [ArrayLike<number>];
  const raw = new Float32Array(n * n);
  const isSea = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const v = raster[i];
    // Some IGN tiles store open sea as 0 m rather than nodata.
    if (v === NODATA || v <= 0) { isSea[i] = 1; raw[i] = SEA_LEVEL_DM / 10; } else raw[i] = v;
  }
  const height = smooth(raw, n, isSea);
  const out = new Int16Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = isSea[i] ? SEA_LEVEL_DM : Math.round(height[i] * 10);
  writeFileSync(join(dir, site.heightmap.file), Buffer.from(out.buffer));

  console.log(`Ortho ${site.ortho.size}² from PNOA …`);
  const orthoUrl = `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=OI.OrthoimageCoverage&STYLES=` +
    `&CRS=${site.crs}&BBOX=${x0},${y0},${x1},${y1}&WIDTH=${site.ortho.size}&HEIGHT=${site.ortho.size}&FORMAT=image/jpeg`;
  writeFileSync(join(dir, site.ortho.file), Buffer.from(await download(orthoUrl)));

  let max = 0;
  for (const v of height) max = Math.max(max, v);
  console.log(`Done: max elevation ${max.toFixed(0)} m, sea cells ${(isSea.reduce((a, b) => a + b, 0) / (n * n) * 100).toFixed(0)}%`);
}

main().catch((err) => { console.error(err); process.exit(1); });
