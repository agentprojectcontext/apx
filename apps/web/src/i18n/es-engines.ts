import type { enEngines } from "./en-engines.ts";

// UI strings, Spanish: Configuración › Motores y modelos (planes, APIs de modelos) y Sesiones externas (las CLIs).
export const esEngines: Record<keyof typeof enEngines, string> = {
  "config.external": "Sesiones externas",
  "engines.leadModels":
    "Con qué piensan y trabajan tus agentes: tu plan de ChatGPT y las APIs de modelos. Las CLIs como Claude Code o Codex están en Sesiones externas.",
  "providers.hide": "Quitar {name} de la lista",
  "providers.modelsAuto": "Auto",
  "plans.codex.kind": "Plan de ChatGPT",
  "plans.connected": "Conectado",
  "plans.notConnected": "Sin conectar",
  "plans.account": "Cuenta",
  "plans.models": "Modelos",
  "plans.modelsCount": "{count} disponibles",
  "plans.connect": "Conectar",
  "plans.manage": "Administrar",
  "plan.login.title": "Conectar Codex",
  "plan.login.lead":
    "Tus agentes usan los modelos de tu plan de ChatGPT con las herramientas y reglas de APX. APX tiene su propio login, separado del de la app de Codex.",
  "plan.login.preTitle": "Si no te deja terminar",
  "plan.login.preBody":
    "ChatGPT pide activar «Autorización con código de dispositivo para Codex» en Configuración › Seguridad. Sin eso el login no se puede terminar.",
  "plan.login.preLink": "Abrir la seguridad de ChatGPT",
  "plan.login.ifRefused":
    "¿ChatGPT no acepta el código? Puede que tengas que activar «Autorización con código de dispositivo para Codex».",
  "plan.login.start": "Iniciar sesión con ChatGPT",
  "plan.login.fromV1": "Usar el login de APX v1",
  "plan.login.fromV1Hint": "APX v1 ya tiene la sesión iniciada: APX la toma sin pedirte un código nuevo.",
  "plan.login.step1": "Abrí esta página:",
  "plan.login.step2": "Escribí este código ahí:",
  "plan.login.copy": "Copiar código",
  "plan.login.copied": "Código copiado",
  "plan.login.waiting": "Esperando que termines en el navegador…",
  "plan.login.connectedAs": "Conectado como {account}",
  "plan.login.disconnect": "Desconectar",
  "plan.login.failed": "No se pudo iniciar sesión: {error}",
  "providers.unset": "Sin configurar",
  "providers.setUp": "Configurar",
  "providers.unsetKey": "Pegá una clave para usar sus modelos.",
  "providers.unsetLocal": "Corre en tu máquina; no necesita clave.",
  "external.lead":
    "Las CLIs de tus suscripciones. Las usás desde Sesiones externas en la barra lateral, cada una con su propio chat y sus herramientas: no son modelos para tus agentes ni para el router.",
  "external.models": "Sus modelos",
  "external.modelsLead": "Lo que ofrece cada CLI en sus propias sesiones, según lo que informa.",
  "models.effortLevel.none": "Ninguno",
  "models.effortLevel.minimal": "Mínimo",
  "models.effortLevel.low": "Bajo",
  "models.effortLevel.medium": "Medio",
  "models.effortLevel.high": "Alto",
  "models.effortLevel.xhigh": "Muy alto",
  "models.effortLevel.max": "Máximo",
  "models.effortLevel.ultra": "Ultra",
};
