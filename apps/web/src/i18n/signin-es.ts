import type { enSignIn } from "./signin-en.ts";

export const esSignIn: Record<keyof typeof enSignIn, string> = {
  "res.signIn.menu": "Sitios para iniciar sesión",
  "res.signIn.title": "Iniciar sesión con {name}",
  "res.signIn.lead":
    "Los agentes ponen este valor en un campo de inicio de sesión de estos sitios sin verlo. En cualquier otro sitio, te preguntan antes.",
  "res.signIn.kind": "Campo donde va",
  "res.signIn.password": "Contraseña",
  "res.signIn.username": "Usuario",
  "res.signIn.otp": "Código de un solo uso",
  "res.signIn.otpHint":
    "Pegá como valor de esta variable la clave de configuración o la dirección otpauth:// que el sitio da para una app de autenticación. Los agentes completan el código del momento.",
  "res.signIn.anySite": "Cualquier sitio",
  "res.signIn.anySiteHint": "Los agentes pueden escribirlo en cualquier sitio que visiten, sin preguntarte.",
  "res.signIn.sites": "Sitios",
  "res.signIn.wrongSite": "{site} no es la dirección de un sitio",
  "res.signIn.none": "Todavía sin sitios: los agentes te preguntan cada vez.",
  "res.signIn.lastUsed": "Usada por última vez en {site}, {when}",
  "res.signIn.badge": "Inicio de sesión: {sites}",
  "res.signIn.badgeAny": "Inicio de sesión: cualquier sitio",
  "res.signIn.badgeCount": "Inicio de sesión: {n} sitios",
};
