---
title: "Por qué un agente de IA no puede usar una herramienta conectada: guía MCP"
description: "Revisá una conexión MCP por etapas: alcance, aprobación, inicio de sesión, herramientas disponibles y prueba segura."
lang: es
slug: ai-agent-mcp-connection
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/ai-agent-mcp-connection/hero.webp
  alt: "Un cerebro luminoso se conecta mediante un enchufe a una red de iconos de herramientas."
  caption: "Ilustración conceptual, no una captura de pantalla."
sources:
  - label: "Guía de servidores MCP de APX"
    url: "https://apxagent.app/es/docs/extend/mcp/"
    checked: "2026-11-08"
  - label: "Arquitectura de MCP"
    url: "https://modelcontextprotocol.io/docs/learn/architecture"
    checked: "2026-11-08"
---

Conectaste un servicio y le pediste a un agente que busque algo. Te responde que la herramienta no está disponible. Eso no alcanza para saber si el servicio está caído, falta iniciar sesión o el agente trabaja en otro proyecto. Antes de cambiar credenciales o repetir una acción, revisá la conexión por etapas.

## 1. Identificá la dirección correcta

Un servidor MCP ofrece herramientas a un cliente MCP. Primero definí si querés darle al agente herramientas de otro servicio o permitir que otra aplicación se conecte a tu sistema de agentes. Son configuraciones distintas. La [guía de arquitectura de MCP](https://modelcontextprotocol.io/docs/learn/architecture) describe las responsabilidades de hosts, clientes y servidores.

## 2. Revisá el alcance y la confianza

Fijate en qué proyecto trabaja el agente y si el servidor está disponible allí. Leé la definición antes de aprobarla: un comando local puede ejecutar código en tu computadora. No pegues tokens en un repositorio ni en un chat. Usá el almacén de secretos compatible con el producto y concedé solo los accesos necesarios.

En la [guía MCP de APX](https://apxagent.app/es/docs/extend/mcp/), los proyectos heredan servidores globales salvo que se desactiven; un servidor de proyecto requiere aprobación de su definición exacta y vuelve a necesitarla si cambia. APX distingue los servidores que usan sus agentes de los clientes externos que se conectan a APX.

## 3. Revisá el inicio de sesión y las herramientas

Un servidor puede estar configurado pero necesitar inicio de sesión en el navegador o fallar al arrancar. Leé el estado y el error, completá el ingreso vos mismo y usá la prueba o lista de herramientas para ver qué ofrece realmente. En APX, **Recursos › MCP** muestra los servidores e incluye una prueba; la guía también describe diagnósticos desde la terminal. El servidor arranca cuando se usa por primera vez, así que estar inactivo no implica necesariamente una falla.

## 4. Probá una lectura inocua

Elegí una operación de solo lectura sobre datos que estés autorizado a consultar. Revisá la cuenta, el alcance y el resultado antes de pedir modificaciones. Que una prueba de conexión funcione demuestra solo esa prueba; no garantiza que una cuenta tenga permisos para todas las operaciones. Si una escritura agota el tiempo, revisá el destino antes de reintentar para evitar duplicados.

Guardá el error exacto y la etapa en que apareció. Eso ayuda más que volver a conectar todo repetidamente y evita cambiar accesos que no tenían relación con el problema.
