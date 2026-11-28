// The errand taxonomy (rules/ERRANDS_ON_THE_WAY.md#errands-and-their-place): for each category, the OpenStreetMap tags
// and Google type that find its places, owner-facing names, and the keywords of the fallback classifier.
import type { ErrandCategory } from "@apx/protocol";

/**
 * One OSM tag that marks a place of a category. `also` requires more tags (a bank with `atm=yes`); `name` also requires
 * the place's name to match (shop=books named "Librería escolar" sells school supplies in Argentina).
 */
export type OsmSelector = { key: string; value: string; also?: Record<string, string>; name?: RegExp };

export type CategoryDef = {
  label: { es: string; en: string };
  osm: readonly OsmSelector[];
  /** Places (New) Table A type for `includedType`; unset when Google has none (stationery, pickup, optician). */
  googleType?: string;
  googleQuery: { es: string; en: string };
};

const tag = (key: string, ...values: string[]): OsmSelector[] => values.map((value) => ({ key, value }));

/**
 * Taxonomy choices (see ERRANDS_ON_THE_WAY.md#errands-and-their-place):
 * - shop=convenience is both `grocery` (an Argentine almacén is mapped so) and `kiosk` (kioscos often are).
 * - `stationery` is the Argentine "librería" (school and office supplies, copies); shop=books counts only when its
 *   name says escolar/comercial/papelera/artística, since bookshops are also called "librería".
 * - Veterinarias and forrajerías (shop=agrarian) sell pet food, so they count as `pet_store`.
 * - shop=chemist (perfumería) is a secondary `pharmacy` for toiletries; shop=beverages (distribuidora) is `liquor`.
 * - shop=wholesale is left out: many need a membership or sell only in bulk.
 */
export const CATEGORIES: Record<ErrandCategory, CategoryDef> = {
  supermarket: {
    label: { es: "Supermercado", en: "Supermarket" },
    osm: tag("shop", "supermarket"),
    googleType: "supermarket",
    googleQuery: { es: "supermercado", en: "supermarket" },
  },
  grocery: {
    label: { es: "Almacén o verdulería", en: "Grocery" },
    osm: tag("shop", "greengrocer", "convenience", "deli", "dairy", "farm", "health_food"),
    googleType: "grocery_store",
    googleQuery: { es: "almacén verdulería", en: "grocery store" },
  },
  butcher: {
    label: { es: "Carnicería", en: "Butcher" },
    osm: tag("shop", "butcher", "seafood"),
    googleType: "butcher_shop",
    googleQuery: { es: "carnicería", en: "butcher" },
  },
  bakery: {
    label: { es: "Panadería", en: "Bakery" },
    osm: tag("shop", "bakery", "pastry"),
    googleType: "bakery",
    googleQuery: { es: "panadería", en: "bakery" },
  },
  kiosk: {
    label: { es: "Kiosco", en: "Kiosk" },
    osm: tag("shop", "kiosk", "convenience", "newsagent", "confectionery", "tobacco"),
    googleType: "convenience_store",
    googleQuery: { es: "kiosco", en: "convenience store" },
  },
  pharmacy: {
    label: { es: "Farmacia", en: "Pharmacy" },
    osm: [...tag("amenity", "pharmacy"), ...tag("shop", "chemist")],
    googleType: "pharmacy",
    googleQuery: { es: "farmacia", en: "pharmacy" },
  },
  stationery: {
    label: { es: "Librería", en: "Stationery shop" },
    osm: [
      ...tag("shop", "stationery", "copyshop"),
      { key: "shop", value: "books", name: /\b(escolar|comercial|papeler|artistic)/ },
    ],
    googleQuery: { es: "librería artículos escolares", en: "stationery store" },
  },
  bookstore: {
    label: { es: "Librería de libros", en: "Bookshop" },
    osm: tag("shop", "books"),
    googleType: "book_store",
    googleQuery: { es: "librería libros", en: "bookstore" },
  },
  hardware: {
    label: { es: "Ferretería", en: "Hardware store" },
    osm: tag("shop", "hardware", "doityourself", "paint", "trade"),
    googleType: "hardware_store",
    googleQuery: { es: "ferretería", en: "hardware store" },
  },
  electronics: {
    label: { es: "Electrónica", en: "Electronics shop" },
    osm: tag("shop", "electronics", "mobile_phone", "computer", "appliance"),
    googleType: "electronics_store",
    googleQuery: { es: "electrónica", en: "electronics store" },
  },
  clothing: {
    label: { es: "Tienda de ropa", en: "Clothes shop" },
    osm: tag("shop", "clothes", "shoes", "boutique"),
    googleType: "clothing_store",
    googleQuery: { es: "tienda de ropa", en: "clothing store" },
  },
  pet_store: {
    label: { es: "Pet shop o veterinaria", en: "Pet shop" },
    osm: [...tag("shop", "pet", "agrarian"), ...tag("amenity", "veterinary")],
    googleType: "pet_store",
    googleQuery: { es: "pet shop", en: "pet store" },
  },
  garden: {
    label: { es: "Vivero", en: "Garden centre" },
    osm: tag("shop", "garden_centre", "agrarian"),
    googleType: "garden_center",
    googleQuery: { es: "vivero", en: "garden center" },
  },
  florist: {
    label: { es: "Florería", en: "Florist" },
    osm: tag("shop", "florist"),
    googleType: "florist",
    googleQuery: { es: "florería", en: "florist" },
  },
  liquor: {
    label: { es: "Vinoteca o bebidas", en: "Liquor store" },
    osm: tag("shop", "alcohol", "wine", "beverages"),
    googleType: "liquor_store",
    googleQuery: { es: "vinoteca bebidas", en: "liquor store" },
  },
  optician: {
    label: { es: "Óptica", en: "Optician" },
    osm: tag("shop", "optician"),
    googleQuery: { es: "óptica", en: "optician" },
  },
  gas_station: {
    label: { es: "Estación de servicio", en: "Gas station" },
    osm: tag("amenity", "fuel"),
    googleType: "gas_station",
    googleQuery: { es: "estación de servicio", en: "gas station" },
  },
  car_service: {
    label: { es: "Taller o gomería", en: "Car service" },
    osm: [...tag("shop", "car_repair", "tyres", "car_parts"), ...tag("amenity", "car_wash")],
    googleType: "car_repair",
    googleQuery: { es: "taller mecánico gomería", en: "car repair" },
  },
  atm: {
    label: { es: "Cajero automático", en: "ATM" },
    osm: [...tag("amenity", "atm"), { key: "amenity", value: "bank", also: { atm: "yes" } }],
    googleType: "atm",
    googleQuery: { es: "cajero automático", en: "atm" },
  },
  bank: {
    label: { es: "Banco", en: "Bank" },
    osm: tag("amenity", "bank"),
    googleType: "bank",
    googleQuery: { es: "banco", en: "bank" },
  },
  post_office: {
    label: { es: "Correo", en: "Post office" },
    osm: tag("amenity", "post_office"),
    googleType: "post_office",
    googleQuery: { es: "correo", en: "post office" },
  },
  laundry: {
    label: { es: "Lavandería", en: "Laundry" },
    osm: tag("shop", "laundry", "dry_cleaning"),
    googleType: "laundry",
    googleQuery: { es: "lavandería", en: "laundry" },
  },
  pickup: {
    label: { es: "Punto de retiro", en: "Parcel pickup" },
    osm: [...tag("amenity", "parcel_locker", "post_office"), ...tag("shop", "courier"), ...tag("office", "courier")],
    googleQuery: { es: "punto de retiro de paquetes", en: "parcel pickup point" },
  },
};

export const CATEGORY_IDS = Object.keys(CATEGORIES) as ErrandCategory[];

/** For the agent's tool description: every id, with examples only where the right one is not obvious. */
export const CATEGORY_GUIDE =
  "Pick 1-3, best first: supermarket (leche, papas fritas), grocery, butcher, bakery, kiosk, pharmacy, stationery (cuaderno), bookstore, hardware, electronics, clothing, pet_store, garden, florist, liquor, optician, gas_station, car_service, atm, bank, post_office, laundry, pickup (retirar paquete).";

export function categoryLabel(cat: ErrandCategory, lang: "es" | "en"): string {
  return CATEGORIES[cat].label[lang];
}

/** Lowercase, accents off, punctuation to spaces: "Papás Fritas!" → "papas fritas". */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Tags of an OSM element → its categories, in CATEGORIES order. */
export function osmCategories(tags: Record<string, string | undefined>): ErrandCategory[] {
  const name = normalizeText(tags.name ?? "");
  const out: ErrandCategory[] = [];
  for (const cat of CATEGORY_IDS) {
    const hit = CATEGORIES[cat].osm.some(
      (s) =>
        tags[s.key] === s.value &&
        Object.entries(s.also ?? {}).every(([k, v]) => tags[k] === v) &&
        (!s.name || s.name.test(name)),
    );
    if (hit) out.push(cat);
  }
  return out;
}

/** Every OSM key with the values any category selects, for one Overpass query that fetches them all. */
export function osmSelectorValues(): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const def of Object.values(CATEGORIES)) {
    for (const s of def.osm) {
      const values = byKey.get(s.key) ?? [];
      if (!values.includes(s.value)) values.push(s.value);
      byKey.set(s.key, values);
    }
  }
  return byKey;
}

type C = ErrandCategory;
/**
 * Keyword → categories best first (Argentine Spanish and English, written without accents; a plural s/es also
 * matches). A longer phrase wins over the words inside it ("cambio de aceite" is car service, not "aceite").
 */
const KEYWORDS: ReadonlyArray<readonly [readonly string[], readonly C[]]> = [
  // Supermarket staples.
  [
    [
      "super",
      "supermercado",
      "chino",
      "hacer las compras",
      "compras del super",
      "leche",
      "fideo",
      "arroz",
      "lavandina",
      "detergente",
      "yerba",
      "aceite",
      "galletita",
      "azucar",
      "harina",
      "cafe",
      "manteca",
      "yogur",
      "mayonesa",
      "papel higienico",
      "rollo de cocina",
      "jabon",
      "suavizante",
      "esponja",
      "bolsas de residuo",
      "servilleta",
      "atun",
      "conserva",
      "mermelada",
      "dulce de leche",
      "cereal",
      "pure de tomate",
      "salsa",
      "groceries",
      "milk",
      "rice",
      "pasta",
      "detergent",
      "bleach",
      "toilet paper",
      "cookie",
      "coffee",
      "sugar",
      "flour",
      "butter",
    ],
    ["supermarket"],
  ],
  [
    ["papas fritas", "chips", "snack"],
    ["supermarket", "kiosk"],
  ],
  [
    ["gaseosa", "agua", "agua mineral", "soda", "jugo", "water"],
    ["supermarket", "kiosk"],
  ],
  [
    ["queso", "jamon", "fiambre", "huevo", "cheese", "ham", "egg"],
    ["supermarket", "grocery"],
  ],
  [
    ["panal", "shampoo", "desodorante", "pasta de dientes", "cepillo de dientes", "diaper", "toothpaste"],
    ["supermarket", "pharmacy"],
  ],
  [
    ["pila", "battery", "batteries"],
    ["supermarket", "kiosk", "electronics"],
  ],
  [
    ["hielo", "ice"],
    ["kiosk", "supermarket", "gas_station"],
  ],
  [
    ["lamparita", "foco", "light bulb"],
    ["hardware", "supermarket"],
  ],
  // Grocery, butcher, bakery.
  [
    [
      "verdura",
      "verduleria",
      "fruta",
      "tomate",
      "lechuga",
      "cebolla",
      "banana",
      "manzana",
      "naranja",
      "limon",
      "zanahoria",
      "palta",
      "papa",
      "vegetable",
      "fruit",
    ],
    ["grocery", "supermarket"],
  ],
  [
    ["almacen", "fiambreria", "dietetica", "frutos secos"],
    ["grocery", "supermarket"],
  ],
  [
    ["carne", "asado", "milanesa", "chorizo", "vacio", "bife", "carne picada", "cerdo", "pescado", "meat", "fish"],
    ["butcher", "supermarket"],
  ],
  [["carniceria", "polleria", "pescaderia", "butcher"], ["butcher"]],
  [
    ["pollo", "chicken"],
    ["butcher", "supermarket"],
  ],
  [
    ["pan", "facturas", "medialuna", "bread"],
    ["bakery", "supermarket"],
  ],
  [["panaderia", "torta", "sanguchitos de miga", "bizcochito", "budin", "bakery", "cake"], ["bakery"]],
  [
    ["prepizza", "tapas de empanada"],
    ["supermarket", "bakery", "grocery"],
  ],
  // Kiosk.
  [
    [
      "kiosco",
      "kiosko",
      "golosina",
      "chicle",
      "alfajor",
      "caramelo",
      "cargar la sube",
      "carga sube",
      "sube",
      "carga virtual",
      "recarga celular",
      "diario",
      "revista",
      "encendedor",
      "candy",
      "newspaper",
    ],
    ["kiosk"],
  ],
  [
    ["cigarrillo", "pucho", "cigarette"],
    ["kiosk", "gas_station"],
  ],
  // Pharmacy.
  [
    [
      "farmacia",
      "remedio",
      "medicamento",
      "ibuprofeno",
      "paracetamol",
      "aspirina",
      "receta",
      "antibiotico",
      "jarabe",
      "curita",
      "termometro",
      "vitamina",
      "gasa",
      "pharmacy",
      "medicine",
      "prescription",
      "drugstore",
    ],
    ["pharmacy"],
  ],
  [
    ["alcohol en gel", "protector solar", "preservativo", "sunscreen", "condom"],
    ["pharmacy", "supermarket"],
  ],
  [
    ["perfumeria", "perfume"],
    ["pharmacy", "supermarket"],
  ],
  // Stationery, bookstore.
  [
    [
      "libreria",
      "cuaderno",
      "fotocopia",
      "copia",
      "lapicera",
      "birome",
      "carpeta",
      "cartulina",
      "lapiz",
      "goma de borrar",
      "regla",
      "utiles",
      "utiles escolares",
      "resma",
      "hojas",
      "imprimir",
      "impresion",
      "anillado",
      "anillar",
      "plastificar",
      "fibra",
      "marcador",
      "plasticola",
      "papel glase",
      "stationery",
      "pen",
      "printing",
      "photocopy",
      "school supplies",
    ],
    ["stationery"],
  ],
  [["notebook"], ["stationery", "electronics"]],
  [
    ["tijera", "pegamento", "cinta", "cinta scotch", "scissors", "tape", "glue"],
    ["stationery", "hardware"],
  ],
  [
    ["libro", "novela", "book", "bookstore", "bookshop", "manual escolar", "libro de texto"],
    ["bookstore", "stationery"],
  ],
  // Hardware.
  [
    [
      "ferreteria",
      "tornillo",
      "clavo",
      "tarugo",
      "pintura",
      "pinceleria",
      "pincel",
      "rodillo",
      "destornillador",
      "martillo",
      "taladro",
      "mecha",
      "silicona",
      "cinta aisladora",
      "lija",
      "bulon",
      "tuerca",
      "candado",
      "enchufe",
      "cano",
      "llave de paso",
      "hardware",
      "screw",
      "nail",
      "paint",
      "drill",
    ],
    ["hardware"],
  ],
  [
    ["manguera", "hose"],
    ["hardware", "garden"],
  ],
  [
    ["alargue", "zapatilla electrica", "extension cord"],
    ["hardware", "electronics"],
  ],
  // Electronics.
  [
    [
      "cargador",
      "cable usb",
      "auricular",
      "funda",
      "pendrive",
      "mouse",
      "teclado",
      "adaptador",
      "hdmi",
      "celular",
      "charger",
      "headphones",
      "phone case",
      "electronics",
    ],
    ["electronics"],
  ],
  [["cable"], ["electronics", "hardware"]],
  // Clothing.
  [
    [
      "ropa",
      "remera",
      "pantalon",
      "zapatilla",
      "zapato",
      "campera",
      "buzo",
      "malla",
      "uniforme",
      "guardapolvo",
      "clothes",
      "shoe",
      "shirt",
      "jacket",
    ],
    ["clothing"],
  ],
  [
    ["medias", "calzoncillo", "bombacha", "socks", "underwear"],
    ["clothing", "supermarket"],
  ],
  // Pets, garden, florist.
  [
    [
      "alimento para perro",
      "alimento para gato",
      "comida de perro",
      "comida del perro",
      "comida de gato",
      "comida del gato",
      "balanceado",
      "piedras sanitarias",
      "arena para gato",
      "pipeta",
      "antipulgas",
      "pet shop",
      "veterinaria",
      "perro",
      "gato",
      "mascota",
      "dog food",
      "cat food",
      "cat litter",
      "pet",
    ],
    ["pet_store"],
  ],
  [["vivero", "maceta", "tierra", "semilla", "fertilizante", "abono", "cesped", "potting soil", "seeds"], ["garden"]],
  [
    ["planta", "plant"],
    ["garden", "florist"],
  ],
  [["flores", "flor", "ramo", "floreria", "rosas", "flowers", "florist"], ["florist"]],
  // Drinks.
  [
    ["vino", "cerveza", "fernet", "whisky", "vodka", "champagne", "sidra", "wine", "beer"],
    ["liquor", "supermarket"],
  ],
  [["vinoteca", "licoreria", "bebidas", "liquor"], ["liquor"]],
  // Optician.
  [
    [
      "optica",
      "anteojos",
      "lentes",
      "lentes de contacto",
      "liquido para lentes",
      "glasses",
      "contact lenses",
      "optician",
    ],
    ["optician"],
  ],
  // Car.
  [
    [
      "nafta",
      "combustible",
      "gasoil",
      "diesel",
      "gnc",
      "cargar nafta",
      "estacion de servicio",
      "ypf",
      "shell",
      "axion",
      "gas",
      "fuel",
      "petrol",
      "gas station",
      "garrafa",
    ],
    ["gas_station"],
  ],
  [
    ["inflar las gomas", "presion de las gomas", "aire a las gomas", "tire pressure"],
    ["gas_station", "car_service"],
  ],
  [
    [
      "gomeria",
      "mecanico",
      "taller",
      "service del auto",
      "cambio de aceite",
      "cambiar el aceite",
      "lavar el auto",
      "lavadero de autos",
      "goma pinchada",
      "cubierta",
      "neumatico",
      "repuesto",
      "bateria del auto",
      "oil change",
      "car wash",
      "tire",
      "mechanic",
    ],
    ["car_service"],
  ],
  // Money.
  [
    ["cajero", "efectivo", "sacar plata", "extraer", "retirar efectivo", "cash", "atm"],
    ["atm", "bank"],
  ],
  [["plata"], ["atm"]],
  [
    ["banco", "depositar", "deposito", "cheque", "bank"],
    ["bank", "atm"],
  ],
  // Post and parcels.
  [
    ["correo", "carta", "carta documento", "telegrama", "estampilla", "encomienda", "post office", "stamps"],
    ["post_office", "pickup"],
  ],
  [
    ["enviar paquete", "mandar paquete", "despachar", "send a package"],
    ["post_office", "pickup"],
  ],
  [
    [
      "retirar paquete",
      "retirar el paquete",
      "retirar pedido",
      "retirar el pedido",
      "retirar envio",
      "retirar el envio",
      "punto de retiro",
      "mercado libre",
      "locker",
      "pickit",
      "andreani",
      "oca",
      "pick up a package",
      "parcel",
    ],
    ["pickup", "post_office"],
  ],
  [
    ["paquete", "envio", "package"],
    ["pickup", "post_office"],
  ],
  // Laundry.
  [
    [
      "lavanderia",
      "tintoreria",
      "lavar ropa",
      "ropa sucia",
      "llevar la ropa",
      "dejar la ropa",
      "retirar la ropa",
      "buscar la ropa",
      "acolchado",
      "edredon",
      "laundry",
      "dry cleaning",
    ],
    ["laundry"],
  ],
  [["lavadero"], ["laundry", "car_service"]],
];

type Pattern = { re: RegExp; cats: readonly C[]; words: number };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Longest phrases first, so a phrase claims its words before a shorter keyword can. */
const PATTERNS: Pattern[] = KEYWORDS.flatMap(([terms, cats]) =>
  terms.map((t) => {
    const n = normalizeText(t);
    const plural = /(s|es)$/.test(n) ? "" : "(?:s|es)?";
    return {
      re: new RegExp(`(?<![a-z0-9])${escapeRe(n)}${plural}(?![a-z0-9])`, "g"),
      cats,
      words: n.split(" ").length,
    };
  }),
).sort((a, b) => b.words - a.words || b.re.source.length - a.re.source.length);

function score(text: string, weight: number, into: Map<C, number>): void {
  let rest = normalizeText(text);
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    if (!p.re.test(rest)) continue;
    rest = rest.replace(p.re, " | ");
    p.cats.forEach((cat, i) => {
      into.set(cat, (into.get(cat) ?? 0) + weight * p.words * (3 - Math.min(i, 2)));
    });
  }
}

/**
 * Where an errand can be done, best first (at most 3), from its words; [] when nothing matches. Only a fallback for
 * errands no agent categorised: the agent's choice always wins.
 */
export function classifyErrand(title: string, description?: string): ErrandCategory[] {
  const scores = new Map<C, number>();
  score(title, 2, scores);
  if (description) score(description, 1, scores);
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || CATEGORY_IDS.indexOf(a[0]) - CATEGORY_IDS.indexOf(b[0]))
    .slice(0, 3)
    .map(([cat]) => cat);
}
