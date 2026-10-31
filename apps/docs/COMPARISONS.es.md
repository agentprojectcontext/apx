# Comparativas de productos

El índice está en `/compare/` y su traducción en `/es/compare/`. Las páginas se generan desde `src/data/comparisons.ts` con la plantilla `src/components/compare/ComparePage.astro`. Inicio y todas las comparativas comparten el encabezado y footer web reales de `src/components/web/`, con enlace al índice. El footer compartido incluye el [canal oficial de YouTube de APX](https://www.youtube.com/@apx-agents) junto a GitHub y Discord como iconos de redes con etiquetas accesibles. En escritorio, la marca, descripción e iconos de redes quedan en una fila superior junto con un enlace de contacto, las líneas de licencia, marcas y origen, y las plataformas; debajo van los enlaces: producto, un grupo por sección de la guía con el título de cada página y comunidad, apilados de a pares en cinco columnas, más Comparar como columna propia con todas las comparativas; debajo de un separador están el copyright, la disponibilidad para macOS/Windows/Linux/Android y «Hecho con ♥ en Argentina». En móvil, los grupos forman dos columnas con enlaces de tamaño completo y Comparar arranca plegado. Un enlace del pie a una página de la guía que no existe hace fallar el build. Ambos diseños están en inglés y español. La documentación está separada en `/docs/` y `/es/docs/`; ver [Rutas del sitio](SITE_ROUTING.es.md). El menú Comparar del encabezado (al pasar el mouse o con foco, desde 1000 px) muestra `featuredComparison` de `src/data/comparisons.ts` como tarjeta marcada como nueva, las cuatro comparativas siguientes y un enlace a todas; apuntalo al último producto agregado.

## Criterio editorial

- Comparar flujos documentados, no ausencias inferidas ni puntajes universales.
- Dar un motivo útil para elegir cada producto.
- Revisar documentación primaria y licencias antes de cambiar la fecha de revisión. La fecha corresponde a las fuentes, no a una prueba de rendimiento.
- Mantener cada fila y sección en inglés y español. Agregar productos solo con fuentes suficientes; hoy se comparan doce productos.
- Los logos identifican productos ajenos; su procedencia está en `public/brands/README.md`.
- Distinguir costos de proveedores, licencias de software y servicios alojados.

## Fuentes fijadas y descubrimiento desde inicio

Consulta: 2026-10-30. Las citas a documentos y licencias de GitHub están fijadas a commits verificados en `sourceSnapshots`: APX usa la base del sitio revisada `61e82f790c1e4802a8f4e1764ae5ccc86487d3fe`, Hermes `5057eaa3a4d0cbef0e30078418a5115faa62889e`, OpenClaw `b277db00687aabbf245c0d9287139a30bb2a22df` y OpenBot `98e89b61782a2ae7d0aac380d82d824b65179afd`. Cada README y licencia respondió HTTP 200 en esa revisión. Los enlaces a portadas de repositorios sirven para descubrir el producto, no como evidencia inmutable.

Las fuentes web siguen siendo variables: `https://openbot.run/`, `https://openbot.run/compare/hermes-agent`, `https://docs.openclaw.ai/concepts/multi-agent` y `https://docs.openclaw.ai/automation/cron-jobs`. La fecha de consulta no congela su contenido. Los extractos fechados de una nueva consulta se conservan en [Evidencia de fuentes web mutables](COMPARISON_WEB_EVIDENCE.md); el registro distingue afirmaciones del editor de funciones ejercitadas. Revisarlas antes de cambiar afirmaciones o la fecha. El texto de licencia conserva posibles excepciones: un uso fuera de los permisos indicados **puede** requerir otra autorización; no decide sobre uso legítimo ni ofrece asesoramiento legal.

Inicio incorpora `#questions`, seis desplegables nativos con enlaces a documentación, después `#compare` con las tres primeras tarjetas de comparativas (logos oficiales y la frase de cada producto) y un enlace a todas, y luego `#download` y la invitación final. Todos los textos de Inicio están en `src/i18n/home.ts`; el enlace Preguntas del pie lleva a `#questions` desde cualquier página web. El acordeón y las tarjetas no necesitan JavaScript. `e2e/preview/docs/home-discovery.spec.ts` cubre ambos idiomas, teléfono/escritorio, temas, teclado, carga de logos, enlaces, ancho de página y funcionamiento sin scripts.

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

Cada página tiene seis secciones (`#answer`, `#overview`, `#models`, `#difference`, `#try`, `#sources`) a las que se llega con enlaces nativos desde una navegación “En esta página”. Desde 1320 px es un riel a la derecha que aparece cuando la respuesta breve está en pantalla y se va después de la última sección; por debajo es un chip bajo el encabezado con una línea fina de progreso, que abre los mismos enlaces (un `<details>` nativo, así que funciona sin JavaScript). Sin JavaScript no se marca ninguna sección como actual; el script la determina después de medir la página (`src/components/compare/reading.ts`). En teléfono, la tabla conserva su presentación nativa y encabezados de columna/fila dentro de una región horizontal etiquetada y enfocable con teclado, sin transformar celdas en bloques. La preferencia de movimiento reducido desactiva el desplazamiento suave y las animaciones. `e2e/preview/web-nav.ts` abre el riel o el chip, y el menú del encabezado angosto, para las pruebas.

La evidencia editorial se enlaza junto a cada celda, no solo al proyecto general. La fila de plataformas APX incluye explícitamente Android, sin insinuar una app nativa iOS. Se distingue dónde corre el agente Hermes de dónde ejecuta comandos. Se explicitan simétricamente las rutinas y canales de OpenBot, y su licencia remite a los fines permitidos de PolyForm Noncommercial 1.0.0 sin clasificar todo contexto comercial. La procedencia de logos está en `public/brands/README.md`; no se verificaron los permisos de marca.

La comparativa general «Las mejores apps de agentes de IA en 2026» (`/es/compare/best-ai-agent-apps/`, en inglés `/compare/best-ai-agent-apps/`) compara 17 apps con el mismo diseño. Sus datos están en `src/data/roundup/` (`index.ts` para el título, la respuesta breve, los grupos, el benchmark y las preguntas; `personal.ts`, `hosted.ts` y `coding.ts` para cada app, con sus fuentes); los textos de interfaz en `src/i18n/roundup.ts`; la página en `src/components/compare/RoundupPage.astro`. Cada celda se apoya en las `sources` de la app, y el benchmark conserva su fuente, metodología y fecha. Se enlaza desde el índice de comparativas, el menú Comparar del encabezado y el pie; la cubre `e2e/preview/docs/roundup.spec.ts`.

Docs impact: updated — nuevas comparativas bilingües y acceso desde el pie del inicio. Sin cambios en core, protocolo, permisos, estado o publicación.
