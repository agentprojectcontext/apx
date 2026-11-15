import type { enCards } from "./cards-en.ts";

export const esCards: Record<keyof typeof enCards, string> = {
  "cards.choose": "Elegí una opción",
  "cards.chooseTime": "Elegí día y horario",
  "cards.day": "Día",
  "cards.time": "Hora",
  "cards.people": "{count} personas",
  "cards.person": "1 persona",
  "cards.fewer": "Menos",
  "cards.more": "Más",
  "cards.directions": "Cómo llegar",
  "cards.open": "Abrir",
  "cards.you": "Estás acá",
  "cards.copy": "Copiar",
  "cards.copied": "Copiado",
  "cards.sent": "Enviado",
  "cards.option": "Opción {n}",
  "cards.askChoice": "Quiero {quantity} × {option} ({price}). Confirmame antes de pagar.",
  "cards.askCompare": "Vamos con {option}.",
  "cards.askBooking": "Reservá en {what}: {day} a las {time}, {people}. Confirmame antes de pagar.",
};
