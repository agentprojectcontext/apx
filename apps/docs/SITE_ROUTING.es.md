# Rutas del sitio

La portada web y las comparativas comparten `src/components/web/WebHeader.astro` y `WebFooter.astro`. Todas muestran los mismos enlaces de navegación, repositorio, Discord, idioma y tema. El cambio de idioma conserva la comparativa que estás leyendo. En teléfono, las secciones aparecen en una fila desplazable horizontalmente, no oculta. El footer incluye solo comparativas publicadas y secciones de documentación existentes.

## Direcciones de documentación

Las fuentes de Starlight conservan sus carpetas. La opción soportada `docsLoader.generateId` genera `/docs/<sección>/<página>/` en inglés y `/es/docs/<sección>/<página>/` en español. El sidebar sigue usando carpetas fuente, no IDs de URL. Starlight conserva su propio encabezado de documentación, buscador, navegación y controles de idioma y tema.

`src/doc-routes.mjs` centraliza la conversión de enlaces Markdown y web. Agrega `DOCS_BASE` una sola vez. El valor predeterminado es `/` en `https://apxagent.app`; `DOCS_BASE=/apx/` permite el prefijo de un proyecto en Pages. Desarrollo y build deben usar los mismos valores.

Las 78 direcciones de contenido anteriores tienen una página HTML estática generada por `src/pages/[...legacy].astro`. `/docs/` y `/es/docs/` también llevan a las respectivas introducciones. Cada página de compatibilidad incluye canonical nuevo, `noindex,follow`, meta refresh inmediato y un enlace visible alternativo. Con JavaScript, `location.replace` conserva query y fragmento.

GitHub Pages no permite enviar un HTTP 301 personalizado desde estos archivos. Las respuestas son HTTP 200; sin JavaScript, meta refresh lleva a la página nueva pero no garantiza conservar query y fragmento. Los IDs de títulos no cambian. Las rutas con barra final o `/index.html` usan la resolución normal del hosting estático; no se redirigen rutas desconocidas por suposición. El sitemap contiene solo páginas canónicas web y de documentación, no las de compatibilidad.

## Colisiones históricas: prioridad aprobada de documentación actual

El sitio ensamblado en Pages también sirve documentación v1 bajo `/v1/`. Su script 404 actual transforma las rutas inexistentes `/docs/*` en `/v1/*` y quita los prefijos `/apx/` y `/v2/`. Un archivo HTML v2 real se sirve antes de ejecutar ese script. Por eso cinco direcciones históricas inglesas de v1 cambiarían de significado:

- `/docs/concepts/agents/`
- `/docs/concepts/memory/`
- `/docs/concepts/projects/`
- `/docs/reference/troubleshooting/`
- `/docs/start/introduction/`

La política aprobada prioriza documentación actual en estas cinco direcciones `/docs/`. Su contenido histórico sigue en las direcciones equivalentes `/v1/`. Las direcciones históricas españolas usan `/docs/es/*`, que sigue llevando a `/v1/es/*`; el árbol español nuevo usa `/es/docs/*`. `/docs/` ya era un alias a la introducción actual antes de este cambio. Esta decisión de rutas no autoriza publicar.

[El inventario histórico completo](HISTORICAL_ROUTES.md) cubre las 80 páginas v1: cinco colisiones inglesas de contenido, el alias raíz preexistente y 74 aliases históricos no colisionantes. Las 40 direcciones españolas antiguas conservan destinos v1.

El workflow llama ahora a `scripts/assemble-site-cli.mjs`, respaldado por la misma función `assembleSite` que usan los tests de navegador, en lugar de duplicar comandos de ensamblado. Copia el build v1 recibido sin modificarlo, reserva las carpetas de versiones, copia los instaladores e incorpora el comportamiento 404 existente. Rechaza una carpeta de salida que ya exista. Esta extracción no cambia la política de redirecciones históricas.

La suite reproducible de ensamblado requiere un build v1 real, no documentación ficticia:

```sh
DOCS_V1_DIST=/path/to/v1/docs/dist pnpm exec playwright test --config e2e/assembled-docs.config.ts
```

Ejecutala desde la raíz del repositorio después de construir v2; construí v1 en una copia temporal independiente con `DOCS_BASE=/v1` y las versiones Node/pnpm fijadas por su workflow. Los tests ensamblan ambos builds en carpetas descartables y sirven archivos estáticos reales; solo las rutas ausentes reciben el 404 ensamblado. Cubren desktop/teléfono, páginas existentes v1/v2, aliases `/docs/`, `/apx/` y `/v2/`, query/fragmento, igualdad de instaladores, rutas desconocidas, comportamiento sin JavaScript y navegación de comparativas. El test histórico exhaustivo compara las 80 páginas HTML originales byte a byte en `/v1/`, comprueba en navegador todos los destinos `/docs/`, `/apx/docs/` y `/docs/…/index.html`, query/fragmento y contenido visible. Exige las cinco prioridades de contenido actual aprobadas, el alias raíz previo y los 74 aliases históricos preservados; adjunta el inventario expandido completo. Publicar sigue requiriendo una aprobación separada.

Una prueba aislada del sitio ensamblado reprodujo las cinco colisiones. Los aliases anidados `/apx/` y `/v2/` conservan query y fragmento al pasar por los redirects v2 nuevos. La raíz `/v2/` ahora conserva ambos con JavaScript; sin scripts, el meta refresh sigue llegando a `/` pero no puede conservarlos. Los aliases implementados solo en el script 404 requieren JavaScript: sin él, las rutas ausentes `/docs/*`, `/apx/*` y `/v2/*` anidadas quedan en 404; las direcciones directas `/v1/` siguen funcionando. Las rutas desconocidas terminan en 404 sin entrar en un bucle.

El script 404 resuelve el destino con el parser de URL del navegador y verifica que su origen coincida con el origen actual antes de redirigir. Los aliases con dobles barras o barras invertidas, como `/apx//example.com` y `/v2//example.com`, no pueden llevar a otra web. Las regresiones de navegador interceptan navegaciones externas y comprueban que los aliases malformados permanezcan en el 404 local.

El workflow Pages ejecuta esta suite de navegador antes de subir el artefacto y desplegar, usando sus builds reales v1 y v2. Los cambios en la suite también disparan el workflow. Chromium cubre escritorio y teléfono, inventario histórico exhaustivo y casos sin scripts; un fallo bloquea la publicación. El workflow instala la dependencia Playwright existente y fijada en el lockfile raíz, con scripts de instalación desactivados: la suite sirve documentación estática ya construida y no necesita builds de aplicaciones. No incorpora dependencias nuevas ni excepciones al gate.

El header compartido de home y comparativas conserva el selector de idioma, tema, ícono circular GitHub, ícono Discord y botón de descarga adaptado al tema. La descarga lleva a `#download` de la home del idioma actual, también desde comparativas. En anchos reducidos las etiquetas se convierten en íconos accesibles; ninguna acción se oculta y la navegación compartida sigue siendo desplazable.

## Búsqueda e instalación

Pagefind se reconstruye con el HTML nuevo y devuelve direcciones `/docs/…` o `/es/docs/…`. Las páginas de compatibilidad no aparecen como resultados de documentación. El buscador debe probarse con un build de producción; el modo de desarrollo de Astro no genera su índice.

Los instaladores siguen en `<base>install.sh` y `<base>install.ps1`, fuera de documentación. No cambian su contenido ni el workflow de release. Los despliegues raíz y `/apx/` se comprueban por separado; al publicar hay que verificar el despliegue remoto Pages y el dominio personalizado.

## Comprobaciones

Desde `apps/docs`, ejecutá `pnpm build && pnpm check`. Para un prefijo de proyecto, ejecutá `DOCS_BASE=/apx/ pnpm build && DOCS_BASE=/apx/ pnpm check`. Restaurá el build raíz antes de compartir su preview. Los tests de artefactos verifican cada par de rutas antiguas/nuevas, canonical, sitemap y preservación bilingüe. Desde la raíz del repositorio, ejecutá `pnpm exec playwright test --config e2e/docs-comparisons.config.ts` para navegación, idioma, tema, búsqueda, descarga de instaladores, redirects e indicador de lectura en desktop y teléfono.

La dependencia explícita `@astrojs/sitemap` reutiliza la integración ya requerida por Starlight. Se declara directamente para configurar filtros e idiomas mediante su API soportada, excluyendo compatibilidad sin modificar XML generado ni depender de imports transitivos.

Docs impact: updated — este archivo, su versión inglesa, README y las guías bilingües de comparativas explican las nuevas rutas y límites. Sin cambios de core, protocolo, estado privado ni autorización.
