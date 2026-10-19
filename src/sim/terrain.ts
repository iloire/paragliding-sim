// Heightmap over a square site. Local frame: x east, y north, metres, origin at the
// south-west corner of the bbox. Samples are pixel centres, row 0 = north edge
// (the order the WCS GeoTIFF arrives in). A heightmap can also cover one square tile
// of the site (its own origin), and the site's map then prefers those finer tiles.

export const SEA_FLOOR_M = -15;

export class Heightmap {
  readonly pixel: number;
  /** Ground beyond the site's edge: the sea floor for an island, a plain's height inland. */
  outside = SEA_FLOOR_M;
  private detailTile = 0;
  private readonly detail = new Map<number, Heightmap>();

  constructor(
    readonly size: number,
    readonly extent: number,
    readonly data: Float32Array,
    /** South-west corner in the site frame, for a heightmap covering one tile. */
    readonly x0 = 0,
    readonly y0 = 0,
  ) {
    if (data.length !== size * size) throw new Error(`heightmap needs ${size * size} samples, got ${data.length}`);
    this.pixel = extent / size;
  }

  /** From the game file: Int16 little-endian, `unitM` metres a step (decimetres by default). */
  static fromInt16(buffer: ArrayBuffer, size: number, extent: number, unitM = 0.1, x0 = 0, y0 = 0): Heightmap {
    const raw = new Int16Array(buffer);
    const data = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = raw[i] * unitM;
    return new Heightmap(size, extent, data, x0, y0);
  }

  /** Registers a finer heightmap over tile (col, row) of a tileM grid; heightAt uses it there. */
  addDetail(tileM: number, col: number, row: number, map: Heightmap): void {
    if (this.detailTile && this.detailTile !== tileM) throw new Error('detail tiles must share one size');
    this.detailTile = tileM;
    this.detail.set(row * 1000 + col, map);
  }

  /** The detail heightmap covering a point, if any. */
  detailAt(x: number, y: number): Heightmap | undefined {
    if (!this.detailTile) return undefined;
    return this.detail.get(Math.floor(y / this.detailTile) * 1000 + Math.floor(x / this.detailTile));
  }

  /** Builds a heightmap from a function of local (x, y) — used by tests and tools. */
  static fromFunction(size: number, extent: number, fn: (x: number, y: number) => number, x0 = 0, y0 = 0): Heightmap {
    const data = new Float32Array(size * size);
    const px = extent / size;
    for (let row = 0; row < size; row++) {
      const y = y0 + extent - (row + 0.5) * px;
      for (let col = 0; col < size; col++) data[row * size + col] = fn(x0 + (col + 0.5) * px, y);
    }
    return new Heightmap(size, extent, data, x0, y0);
  }

  /** Terrain elevation (bilinear). Outside the site it is `outside`: open sea, or a plain. */
  heightAt(x: number, y: number): number {
    const tile = this.detailAt(x, y);
    if (tile) return tile.heightAt(x, y);
    x -= this.x0;
    y -= this.y0;
    if (x < 0 || y < 0 || x > this.extent || y > this.extent) return this.outside;
    const n = this.size;
    const u = Math.min(Math.max(x / this.pixel - 0.5, 0), n - 1);
    const v = Math.min(Math.max((this.extent - y) / this.pixel - 0.5, 0), n - 1);
    const c0 = Math.floor(u), r0 = Math.floor(v);
    const c1 = Math.min(c0 + 1, n - 1), r1 = Math.min(r0 + 1, n - 1);
    const fu = u - c0, fv = v - r0;
    const d = this.data;
    const top = d[r0 * n + c0] * (1 - fu) + d[r0 * n + c1] * fu;
    const bottom = d[r1 * n + c0] * (1 - fu) + d[r1 * n + c1] * fu;
    return top * (1 - fv) + bottom * fv;
  }

  /** The surface you touch down on: land, or the sea surface. */
  groundAt(x: number, y: number): number {
    return Math.max(this.heightAt(x, y), 0);
  }

  isWater(x: number, y: number): boolean {
    return this.heightAt(x, y) < 0.5;
  }

  /** Compass heading (radians) of steepest descent around a point — the way a launch faces. */
  downhillHeading(x: number, y: number, radius = 80): number {
    let best = 0, lowest = Infinity;
    for (let i = 0; i < 72; i++) {
      const h = (i / 72) * Math.PI * 2;
      const z = this.heightAt(x + Math.sin(h) * radius, y + Math.cos(h) * radius);
      if (z < lowest) { lowest = z; best = h; }
    }
    return best;
  }
}
