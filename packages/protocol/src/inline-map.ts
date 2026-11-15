// The street map under a places card: which tiles to draw and where each point sits, shared by the panel and the phone.

export interface MapPoint {
  lat: number;
  lng: number;
}

/** One map tile, placed in percent of the frame (left/top/width/height). */
export interface MapTile {
  key: string;
  url: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MapFrame {
  zoom: number;
  /** Where a point sits, in percent of the frame's width and height. */
  at(point: MapPoint): { x: number; y: number };
  tiles(mode: "light" | "dark"): MapTile[];
}

export const MAP_CREDIT = "Esri, HERE, Garmin, © OpenStreetMap";
const TILE = 256;
const WIDTH = 640;
const MIN_ZOOM = 3;
const MAX_ZOOM = 16;

/** A point in Web Mercator pixels at `zoom`. */
function world(point: MapPoint, zoom: number): { x: number; y: number } {
  const size = TILE * 2 ** zoom;
  const lat = Math.max(-85, Math.min(85, point.lat)) * (Math.PI / 180);
  return {
    x: ((point.lng + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * size,
  };
}

/**
 * The closest view that holds every point with room around it (pins stand above their point, so the view sits a
 * little lower). Between two tile zooms the tiles are drawn larger, so the places fill the frame. `aspect` is width
 * over height.
 */
export function mapFrame(points: MapPoint[], aspect = 16 / 9): MapFrame {
  const height = WIDTH / aspect;
  const flat = points.map((p) => world(p, 0));
  const span = (values: number[]) => Math.max(...values) - Math.min(...values);
  const fit = Math.min(
    (WIDTH * 0.8) / (span(flat.map((p) => p.x)) || Number.MIN_VALUE),
    (height * 0.62) / (span(flat.map((p) => p.y)) || Number.MIN_VALUE),
  );
  const ideal = Math.log2(fit);
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.floor(ideal)));
  const grow = ideal >= MAX_ZOOM ? 1 : Math.max(1, Math.min(2, 2 ** (ideal - zoom)));
  const tile = TILE * grow;
  const at = points.map((p) => world(p, zoom));
  const xs = at.map((p) => p.x * grow);
  const ys = at.map((p) => p.y * grow);
  const left = (Math.min(...xs) + Math.max(...xs)) / 2 - WIDTH / 2;
  const top = (Math.min(...ys) + Math.max(...ys)) / 2 - height / 2 - height * 0.06;
  const count = 2 ** zoom;
  return {
    zoom,
    at(point) {
      const p = world(point, zoom);
      return { x: ((p.x * grow - left) / WIDTH) * 100, y: ((p.y * grow - top) / height) * 100 };
    },
    tiles(mode) {
      const style = mode === "dark" ? "World_Dark_Gray_Base" : "World_Light_Gray_Base";
      const out: MapTile[] = [];
      for (let ty = Math.floor(top / tile); ty * tile < top + height; ty++) {
        if (ty < 0 || ty >= count) continue;
        for (let tx = Math.floor(left / tile); tx * tile < left + WIDTH; tx++) {
          const x = ((tx % count) + count) % count;
          out.push({
            key: `${zoom}/${tx}/${ty}`,
            url: `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${style}/MapServer/tile/${zoom}/${ty}/${x}`,
            left: ((tx * tile - left) / WIDTH) * 100,
            top: ((ty * tile - top) / height) * 100,
            width: (tile / WIDTH) * 100,
            height: (tile / height) * 100,
          });
        }
      }
      return out;
    },
  };
}
