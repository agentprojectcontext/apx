---
title: "Cómo usar un agente de IA en una web sin compartirle tu contraseña"
description: "Guía práctica para iniciar sesión, tomar el control y limitar el acceso del agente."
lang: es
slug: ai-agent-browser-login-safely
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/ai-agent-browser-login-safely/hero.webp
  alt: "Una ventana de navegador con un candado y una flecha."
  caption: "Ilustración conceptual, no es una captura de pantalla."
sources:
  - label: "Documentación de APX"
    url: "https://apxagent.app/es/docs/office/browser/"
    checked: "2026-11-08"
---

Una página le pide al agente que inicie sesión. Mandarle la contraseña por chat parece rápido, pero deja una credencial en un lugar pensado para mensajes. Antes, decidí quién inicia sesión, qué sesión de navegador usa el agente y qué debe hacer después.

## Tomá el control en el paso sensible

Pedile que abra el sitio previsto y te pase la pestaña. Revisá la dirección, iniciá sesión vos y devolvé el control cuando estés listo. No pegues contraseñas, códigos de un solo uso ni números de tarjeta en la conversación. Si aparece un CAPTCHA o una verificación adicional, resolvela vos; no le pidas que la esquive.

En el [navegador de APX](https://apxagent.app/es/docs/office/browser/), el agente puede pedirte el control mientras espera. Para tomarlo tiene que estar disponible el navegador de escritorio; en un servidor sin interfaz no se puede hacer de la misma manera. Consultá la guía para tu instalación.

## Elegí el acceso de forma deliberada

APX también documenta variables de inicio de sesión limitadas por sitio: el agente nombra la variable y el navegador completa el tipo de campo autorizado sin mostrarle el valor. Es opcional y no justifica habilitar el secreto para cualquier web. También se puede importar una sesión existente para un dominio con aprobación. Revisá sitio, cuenta y perfil: un perfil compartido puede dejar esa sesión disponible para otros agentes que lo usen.

## Comprobá el trabajo y cerrá el acceso

1. Pedí una tarea acotada, sin cambios destructivos, y nombrá el sitio.
2. Leé cada aprobación y revisá el destino antes de enviar o modificar algo.
3. Inspeccioná el resultado real, no solo el inicio de sesión.
4. Cuando no necesites más acceso, cerrá sesión en el sitio y revisá los permisos. Quitar una variable no cierra una sesión que ya estaba abierta.

El acceso al navegador sigue teniendo riesgos: un sitio legítimo ve lo que le enviás y una cuenta conectada puede alcanzar datos sensibles. Usá solo cuentas y sitios de confianza.
