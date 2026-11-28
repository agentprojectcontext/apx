import assert from "node:assert/strict";
import { test } from "node:test";
import { ErrandCategory } from "@apx/protocol";
import {
  CATEGORIES,
  CATEGORY_GUIDE,
  categoryLabel,
  classifyErrand,
  osmCategories,
  osmSelectorValues,
} from "./categories.ts";

// [errand, the categories it must start with (best first)]
const CASES: Array<[string, ErrandCategory[]]> = [
  ["Comprar leche", ["supermarket"]],
  ["papas fritas para la juntada", ["supermarket", "kiosk"]],
  ["Lavandina y detergente", ["supermarket"]],
  ["yerba", ["supermarket"]],
  ["Comprar pilas AA", ["supermarket", "kiosk", "electronics"]],
  ["verdura para la semana", ["grocery", "supermarket"]],
  ["Tomates y lechuga", ["grocery", "supermarket"]],
  ["Carne para el asado", ["butcher", "supermarket"]],
  ["Medialunas", ["bakery", "supermarket"]],
  ["Torta para el cumple", ["bakery"]],
  ["Cargar la SUBE", ["kiosk"]],
  ["Ibuprofeno", ["pharmacy"]],
  ["Retirar remedios con la receta", ["pharmacy"]],
  ["Cuaderno y lapiceras para el colegio", ["stationery"]],
  ["Fotocopias del DNI", ["stationery"]],
  ["Cartulina", ["stationery"]],
  ["Tornillos y tarugos", ["hardware"]],
  ["Pintura para la pared", ["hardware"]],
  ["Cargar nafta", ["gas_station"]],
  ["Llevar la ropa a la tintorería", ["laundry"]],
  ["Combustible", ["gas_station"]],
  ["Sacar plata del cajero", ["atm", "bank"]],
  ["Retirar el paquete de Mercado Libre", ["pickup", "post_office"]],
  ["Mandar una carta documento", ["post_office", "pickup"]],
  ["Llevar el acolchado a la lavandería", ["laundry"]],
  ["Alimento para el perro", ["pet_store"]],
  ["Comprar flores para mamá", ["florist"]],
  ["Vino para la cena", ["liquor", "supermarket"]],
  ["Cambio de aceite del auto", ["car_service"]],
  ["Gomería: goma pinchada", ["car_service"]],
  ["Retirar anteojos en la óptica", ["optician"]],
  ["Cargador para el celular", ["electronics"]],
  ["Maceta y tierra", ["garden"]],
  ["Remera para el nene", ["clothing"]],
  ["buy milk and bread", ["supermarket", "bakery"]],
  ["pick up prescription", ["pharmacy"]],
  ["get cash", ["atm", "bank"]],
  ["Dog food", ["pet_store"]],
];

test("classifyErrand puts each errand's places first, best first", () => {
  for (const [title, want] of CASES) {
    const got = classifyErrand(title);
    assert.deepEqual(got.slice(0, want.length), want, `${title} → ${got.join(", ")}`);
    assert.ok(got.length <= 3);
  }
});

test("classifyErrand ignores case and accents and needs whole words", () => {
  assert.deepEqual(classifyErrand("FARMACIA"), classifyErrand("farmácia"));
  // "pan" inside "pantalón" is not bread.
  assert.deepEqual(classifyErrand("Pantalón"), ["clothing"]);
  // A phrase claims its words: "cambio de aceite" is not supermarket oil.
  assert.ok(!classifyErrand("cambio de aceite").includes("supermarket"));
});

test("classifyErrand reads the description when the title says nothing", () => {
  assert.deepEqual(classifyErrand("Lo de mañana", "comprar ibuprofeno"), ["pharmacy"]);
  assert.equal(classifyErrand("Pilas", "y una lapicera")[0], "supermarket");
});

test("classifyErrand never guesses", () => {
  assert.deepEqual(classifyErrand("Llamar a Juan"), []);
  assert.deepEqual(classifyErrand("asdf qwerty"), []);
  assert.deepEqual(classifyErrand(""), []);
  assert.deepEqual(classifyErrand("Pensar en el viaje"), []);
});

test("every category has a definition, labels in sentence case and OSM tags", () => {
  for (const cat of ErrandCategory.options) {
    const def = CATEGORIES[cat];
    assert.ok(def.osm.length > 0, cat);
    for (const lang of ["es", "en"] as const) {
      const label = categoryLabel(cat, lang);
      assert.ok(label && label[0] === label[0]?.toUpperCase(), `${cat} ${lang}`);
      assert.ok(def.googleQuery[lang].length > 0);
    }
  }
  assert.equal(categoryLabel("stationery", "es"), "Librería");
});

test("CATEGORY_GUIDE is short and names every category", () => {
  assert.ok(CATEGORY_GUIDE.length <= 300, `${CATEGORY_GUIDE.length}`);
  for (const cat of ErrandCategory.options) assert.match(CATEGORY_GUIDE, new RegExp(`\\b${cat}\\b`));
});

test("osmCategories reads tags, with extra tags and names where they matter", () => {
  assert.deepEqual(osmCategories({ shop: "supermarket" }), ["supermarket"]);
  assert.deepEqual(osmCategories({ shop: "convenience" }), ["grocery", "kiosk"]);
  assert.deepEqual(osmCategories({ amenity: "bank" }), ["bank"]);
  assert.deepEqual(osmCategories({ amenity: "bank", atm: "yes" }), ["atm", "bank"]);
  assert.deepEqual(osmCategories({ shop: "books", name: "Librería El Lector" }), ["bookstore"]);
  assert.deepEqual(osmCategories({ shop: "books", name: "Librería Escolar Acme" }), ["stationery", "bookstore"]);
  assert.deepEqual(osmCategories({ amenity: "post_office" }), ["post_office", "pickup"]);
  assert.deepEqual(osmCategories({ amenity: "restaurant" }), []);
  const values = osmSelectorValues();
  assert.ok(values.get("shop")?.includes("stationery"));
  assert.ok(values.get("amenity")?.includes("fuel"));
});
