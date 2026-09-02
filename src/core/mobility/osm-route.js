import { listTasksAcrossProjects } from "#core/stores/tasks.js";

const USER_AGENT = "APX mobility assistant/1.0";
const RADIUS_METERS = 700;

const NEEDS = [
  {
    id: "stationery",
    query: "papelería",
    match: /cartulina|papeler[ií]a|cuaderno|l[aá]piz|lapicera|fibra|marcador|impresi[oó]n/i,
    selectors: ['["shop"~"stationery|books|convenience|kiosk"]'],
  },
  {
    id: "supermarket",
    query: "supermercado",
    match: /an[oó]nima|supermercado|mercado|hacer (?:las )?compras|comprar comida|almac[eé]n/i,
    selectors: ['["shop"~"supermarket|convenience"]'],
  },
  {
    id: "pharmacy",
    query: "farmacia",
    match: /farmacia|medicamento|remedio|receta/i,
    selectors: ['["amenity"="pharmacy"]'],
  },
  {
    id: "hardware",
    query: "ferretería",
    match: /ferreter[ií]a|tornillo|herramienta|pintura/i,
    selectors: ['["shop"~"hardware|doityourself|paint"]'],
  },
  {
    id: "fuel",
    query: "estación de servicio",
    match: /nafta|combustible|cargar tanque|estaci[oó]n de servicio/i,
    selectors: ['["amenity"="fuel"]'],
  },
];

export function activeTasks(projects) {
  const entries = [];
  for (const entry of projects?.list?.() || []) {
    let project;
    try { project = projects.get(entry.id); } catch { continue; }
    if (!project?.storagePath) continue;
    entries.push({ ...entry, storagePath: project.storagePath });
  }
  const { tasks } = listTasksAcrossProjects(entries, { limit: 100 });
  return tasks.filter((task) => !["done", "dropped", "cancelled"].includes(task.status));
}

export function taskNeeds(task) {
  const text = `${task.title || ""} ${task.body || ""} ${(task.tags || []).join(" ")}`;
  return NEEDS.filter((need) => need.match.test(text)).map((need) => ({
    ...need,
    query: need.id === "supermarket" && /an[oó]nima/i.test(text) ? "La Anónima" : need.query,
  }));
}

async function getJson(url, options = {}, fetchFn = fetch) {
  const response = await fetchFn(url, {
    ...options,
    headers: { "user-agent": USER_AGENT, accept: "application/json", ...(options.headers || {}) },
    signal: options.signal || AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`map service HTTP ${response.status}`);
  return response.json();
}

export async function geocodeDestination(query, origin, fetchFn = fetch) {
  if (!query) return null;
  const params = new URLSearchParams({ format: "jsonv2", limit: "1", countrycodes: "ar", q: query });
  if (origin) {
    const delta = 1.5;
    params.set("viewbox", `${origin.longitude - delta},${origin.latitude + delta},${origin.longitude + delta},${origin.latitude - delta}`);
    params.set("bounded", "0");
  }
  const rows = await getJson(`https://nominatim.openstreetmap.org/search?${params}`, {}, fetchFn);
  if (!rows?.length) return null;
  return { latitude: Number(rows[0].lat), longitude: Number(rows[0].lon), label: rows[0].display_name || query };
}

export async function drivingRoute(origin, destination, fetchFn = fetch) {
  try {
    const request = {
      locations: [
        { lat: origin.latitude, lon: origin.longitude },
        { lat: destination.latitude, lon: destination.longitude },
      ],
      costing: "auto",
      directions_options: { units: "kilometers" },
    };
    const data = await getJson(`https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(JSON.stringify(request))}`, {}, fetchFn);
    const summary = data?.trip?.summary;
    const shape = data?.trip?.legs?.[0]?.shape;
    if (summary && shape) {
      return {
        distance_m: Number(summary.length) * 1000,
        duration_s: Number(summary.time),
        points: decodePolyline(shape),
      };
    }
  } catch { /* fall through to public OSRM endpoints */ }
  const coords = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const bases = [
    "https://routing.openstreetmap.de/routed-car/route/v1/driving",
    "https://router.project-osrm.org/route/v1/driving",
  ];
  for (const base of bases) {
    try {
      const data = await getJson(`${base}/${coords}?overview=full&geometries=geojson`, {}, fetchFn);
      const route = data?.routes?.[0];
      if (!route?.geometry?.coordinates?.length) continue;
      return {
        distance_m: route.distance,
        duration_s: route.duration,
        points: route.geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude })),
      };
    } catch { /* try the next public OSRM endpoint */ }
  }
  return null;
}

export function decodePolyline(encoded, precision = 6) {
  const factor = 10 ** precision;
  const points = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    const read = () => {
      let result = 0;
      let shift = 0;
      let byte;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index <= encoded.length);
      return (result & 1) ? ~(result >> 1) : result >> 1;
    };
    latitude += read();
    longitude += read();
    points.push({ latitude: latitude / factor, longitude: longitude / factor });
  }
  return points;
}

/**
 * Nominatim `viewbox` string (left,top,right,bottom) around a set of points.
 *
 * `padDegrees` exists because the live geofence (./geofence.js) searches around
 * ONE point — the phone's current position — and a box built from a single
 * point has zero area, which Nominatim answers with nothing at all. A route has
 * its own extent and needs no padding.
 */
export function boundingBox(points, padDegrees = 0) {
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const left = Math.min(...longitudes) - padDegrees;
  const right = Math.max(...longitudes) + padDegrees;
  const top = Math.max(...latitudes) + padDegrees;
  const bottom = Math.min(...latitudes) - padDegrees;
  return `${left},${top},${right},${bottom}`;
}

export async function nearbyPois(route, needs, fetchFn = fetch, { padDegrees = 0 } = {}) {
  if (!route?.points?.length || !needs.length) return [];
  const viewbox = boundingBox(route.points, padDegrees);
  const seen = new Set();
  const rows = [];
  for (const [index, need] of needs.slice(0, 3).entries()) {
    if (index > 0 && fetchFn === fetch) await new Promise((resolve) => setTimeout(resolve, 1_100));
    const params = new URLSearchParams({
      format: "jsonv2", limit: "15", countrycodes: "ar", bounded: "1", viewbox, q: need.query,
    });
    const data = await getJson(`https://nominatim.openstreetmap.org/search?${params}`, {}, fetchFn);
    for (const element of data || []) {
      const latitude = Number(element.lat);
      const longitude = Number(element.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      const key = `${need.id}:${latitude.toFixed(5)},${longitude.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        name: String(element.display_name || need.query).split(",")[0],
        latitude,
        longitude,
        tags: { need_id: need.id },
      });
    }
  }
  return rows;
}

export function haversineMeters(a, b) {
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function distanceToRoute(poi, route) {
  return Math.min(...route.points.map((point) => haversineMeters(poi, point)));
}

function mapLink(poi) {
  return `https://www.google.com/maps/search/?api=1&query=${poi.latitude},${poi.longitude}`;
}

function needMatchesPoi(need, poi) {
  if (poi.tags.need_id) return poi.tags.need_id === need.id;
  const shop = poi.tags.shop || "";
  const amenity = poi.tags.amenity || "";
  if (need.id === "stationery") return /stationery|books|convenience|kiosk/.test(shop);
  if (need.id === "supermarket") return /supermarket|convenience/.test(shop);
  if (need.id === "pharmacy") return amenity === "pharmacy";
  if (need.id === "hardware") return /hardware|doityourself|paint/.test(shop);
  if (need.id === "fuel") return amenity === "fuel";
  return false;
}

export async function enrichMobilityEvent(event, ctx, fetchFn = fetch) {
  if (!event.origin || !event.destination) return { checked: false, reason: "missing-endpoint", candidates: [] };
  const tasks = activeTasks(ctx.projects).map((task) => ({ task, needs: taskNeeds(task) })).filter((row) => row.needs.length);
  if (!tasks.length) return { checked: true, reason: "no-physical-needs", candidates: [] };
  try {
    const destination = await geocodeDestination(event.destination, event.origin, fetchFn);
    if (!destination) return { checked: false, reason: "destination-not-geocoded", candidates: [] };
    const route = await drivingRoute(event.origin, destination, fetchFn);
    if (!route) return { checked: false, reason: "route-not-found", candidates: [] };
    const needs = [...new Map(tasks.flatMap((row) => row.needs).map((need) => [`${need.id}:${need.query}`, need])).values()];
    const pois = await nearbyPois(route, needs, fetchFn);
    const candidates = [];
    for (const row of tasks) {
      const compatible = pois.filter((poi) => row.needs.some((need) => needMatchesPoi(need, poi)));
      for (const poi of compatible) {
        const distance_m = Math.round(distanceToRoute(poi, route));
        if (distance_m > RADIUS_METERS) continue;
        candidates.push({ task_id: row.task.id, task: row.task.title, place: poi.name, distance_m, maps_url: mapLink(poi) });
      }
    }
    candidates.sort((a, b) => a.distance_m - b.distance_m);
    const unique = candidates.filter((candidate, index, all) => all.findIndex((other) => other.task_id === candidate.task_id && other.place === candidate.place) === index);
    return {
      checked: true,
      origin: event.origin,
      destination,
      route: { distance_m: route.distance_m, duration_s: route.duration_s },
      radius_m: RADIUS_METERS,
      candidates: unique.slice(0, 3),
    };
  } catch (error) {
    return { checked: false, reason: error?.message || String(error), candidates: [] };
  }
}
