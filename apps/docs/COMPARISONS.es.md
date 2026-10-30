# Comparativas de productos

El índice está en `/compare/` y su traducción en `/es/compare/`. Las páginas se generan desde `src/data/comparisons.ts` con la plantilla `src/components/compare/ComparePage.astro`. Inicio y todas las comparativas comparten el encabezado y footer web reales de `src/components/web/`, con enlace al índice. El footer compartido incluye el [canal oficial de YouTube de APX](https://www.youtube.com/@apx-agents) junto a GitHub y Discord como iconos de redes con etiquetas accesibles. En escritorio, la marca, descripción e iconos de redes quedan a la izquierda de cuatro columnas de enlaces; debajo de un separador están el copyright, la disponibilidad para macOS/Windows/Linux/Android y «Hecho con ♥ en Argentina». En móvil, las categorías pasan a dos columnas y los elementos inferiores se apilan. Ambos diseños están en inglés y español. La documentación está separada en `/docs/` y `/es/docs/`; ver [Rutas del sitio](SITE_ROUTING.es.md).

## Criterio editorial

- Comparar flujos documentados, no ausencias inferidas ni puntajes universales.
- Dar un motivo útil para elegir cada producto.
- Revisar documentación primaria y licencias antes de cambiar la fecha de revisión. La fecha corresponde a las fuentes, no a una prueba de rendimiento.
- Mantener cada fila y sección en inglés y español. Agregar productos solo con fuentes suficientes; la primera selección incluye Hermes Agent, OpenClaw y OpenBot.
- Los logos identifican productos ajenos; su procedencia está en `public/brands/README.md`.
- Distinguir costos de proveedores, licencias de software y servicios alojados.

## Fuentes fijadas y descubrimiento desde inicio

Consulta: 2026-10-30. Las citas a documentos y licencias de GitHub están fijadas a commits verificados en `sourceSnapshots`: APX usa la base del sitio revisada `61e82f790c1e4802a8f4e1764ae5ccc86487d3fe`, Hermes `5057eaa3a4d0cbef0e30078418a5115faa62889e`, OpenClaw `b277db00687aabbf245c0d9287139a30bb2a22df` y OpenBot `98e89b61782a2ae7d0aac380d82d824b65179afd`. Cada README y licencia respondió HTTP 200 en esa revisión. Los enlaces a portadas de repositorios sirven para descubrir el producto, no como evidencia inmutable.

Las fuentes web siguen siendo variables: `https://openbot.run/`, `https://openbot.run/compare/hermes-agent`, `https://docs.openclaw.ai/concepts/multi-agent` y `https://docs.openclaw.ai/automation/cron-jobs`. La fecha de consulta no congela su contenido. Los extractos fechados de una nueva consulta se conservan en [Evidencia de fuentes web mutables](COMPARISON_WEB_EVIDENCE.md); el registro distingue afirmaciones del editor de funciones ejercitadas. Revisarlas antes de cambiar afirmaciones o la fecha. El texto de licencia conserva posibles excepciones: un uso fuera de los permisos indicados **puede** requerir otra autorización; no decide sobre uso legítimo ni ofrece asesoramiento legal.

Inicio incorpora `#questions`, seis desplegables nativos con enlaces a documentación y después exactamente tres tarjetas de comparativas con logos locales y blobs APX. Los textos están en `src/i18n/home-discovery.ts`; el enlace a preguntas se comparte entre páginas web. El acordeón y las tarjetas no necesitan JavaScript. `e2e/preview/docs/home-discovery.spec.ts` cubre ambos idiomas, teléfono/escritorio, temas, teclado, carga de logos, enlaces y funcionamiento sin scripts.

Docs impact: updated — notas bilingües de mantenimiento y navegación desde inicio.

## Verificación

Desde esta carpeta:

```sh
pnpm install --frozen-lockfile
DOCS_BASE=/ DOCS_SITE=https://apxagent.app pnpm build
pnpm check
pnpm exec astro preview --host 127.0.0.1 --port 4410
```

Desde la raíz del repositorio, con sus dependencias de desarrollo instaladas:

```sh
pnpm exec playwright test --config e2e/docs-comparisons.config.ts
```

Las pruebas usan el sitio compilado: recorren tres productos en dos idiomas y tamaños escritorio/teléfono, verifican imágenes locales, enlaces a fuentes, cambio de idioma, navegación entre comparativas, sección activa al desplazar, teclado y ausencia de desborde horizontal. Guardan capturas de portada, tabla y fuentes en `test-results/docs-comparisons/`. No validan por sí solas las afirmaciones editoriales; también se necesita revisar las fuentes.

La constelación usa enlaces nativos a secciones y mejora progresiva. Sin JavaScript se puede navegar, pero no se actualiza la sección activa al desplazar. Sin JavaScript no se marca ninguna sección como actual; el script la determina después de medir la página. En teléfono, la tabla conserva su presentación nativa y encabezados de columna/fila dentro de una región horizontal etiquetada y enfocable con teclado, sin transformar celdas en bloques. La preferencia de movimiento reducido desactiva el desplazamiento suave. Debajo del ancho de escritorio la navegación forma parte del documento y no lo tapa.

La evidencia editorial se enlaza junto a cada celda, no solo al proyecto general. La fila de plataformas APX incluye explícitamente Android, sin insinuar una app nativa iOS. Se distingue dónde corre el agente Hermes de dónde ejecuta comandos. Se explicitan simétricamente las rutinas y canales de OpenBot, y su licencia remite a los fines permitidos de PolyForm Noncommercial 1.0.0 sin clasificar todo contexto comercial. La procedencia de logos está en `public/brands/README.md`; no se verificaron los permisos de marca.

Docs impact: updated — nuevas comparativas bilingües y acceso desde el pie del inicio. Sin cambios en core, protocolo, permisos, estado o publicación.
