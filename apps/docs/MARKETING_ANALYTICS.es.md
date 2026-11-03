# Medición del sitio

Estado: rama de implementación, sin desplegar. Se mantiene una sola etiqueta directa de Google después de aceptar. No agregar GTM ni activar medición mejorada: duplicaría eventos y podría exponer consultas o detalles de enlaces. GTM sólo se justifica si varias etiquetas independientes necesitan un proceso de publicación revisado.

## Contrato

Todos los eventos incluyen la ruta compilada, sin consulta ni fragmento, origen de referencia vacío y título fijo `APX website`. No se envían comandos, textos de enlaces, direcciones de destino, formularios ni identificadores de cuentas.

| Evento | Significado | Parámetros adicionales |
| --- | --- | --- |
| `page_view` | Una carga de página con consentimiento | Ninguno |
| `download_click` | Clic en archivo oficial, no descarga completada ni instalación | `os`, `architecture`, `placement` |
| `install_copy` | Escritura exitosa en portapapeles, no instalación | `placement` |
| `cta_click` | Sección de descarga, guía, releases, código o comunidad | `action`, `placement` |
| `comparison_open` | Clic al índice o artículo comparativo | `destination`, `placement` |
| `navigation_click` | Otra navegación interna de cabecera o pie | `destination`, `placement` |
| `article_complete` | Mitad del marcador final visible, una vez por carga aceptada; no prueba de lectura | `content_type` |

Cada clic genera como máximo un evento. Prioridad: descarga, CTA, comparativa, navegación. Ubicaciones: `header`, `footer`, `hero`, `downloads`, `docs`, `final`, `content`. El sistema y arquitectura corresponden al archivo elegido, no al dispositivo detectado. Un enlace de respaldo a releases es CTA, no descarga. No se reproducen acciones anteriores al consentimiento. Revocar elimina listeners y observador, además de desactivar Google y limpiar cookies.

## Campañas

Sólo se envían estos valores exactos en minúsculas:

- `utm_source`: `youtube`, `github`, `discord`, `newsletter`, `linkedin`, `instagram`, `google`, `bing`.
- `utm_medium`: `organic`, `social`, `video`, `email`, `referral`.
- `utm_campaign`: `launch`, `documentation`, `comparisons`.

Ejemplo: `https://apxagent.app/?utm_source=youtube&utm_medium=video&utm_campaign=launch`.

Se descartan otros parámetros, incluidos `utm_content` y `utm_term`; los valores no admitidos no se hashean. No se guarda atribución antes del consentimiento ni se propagan consultas entre páginas. Luego Google gestiona atribución con sus cookies propias. Identificadores publicitarios y campañas pagas quedan fuera.

## Configuración y comprobación pendientes

Son recomendaciones, no configuraciones ya aplicadas:

1. Registrar dimensiones de evento `os`, `architecture`, `placement`, `action`, `destination`, `content_type` según necesidad y límites de GA.
2. Considerar `download_click` e `install_copy` como eventos clave separados de intención de descarga/copia de comando. No llamarlos instalaciones exitosas ni sumar navegación, lectura o visitas como conversiones.
3. Mantener desactivadas medición mejorada, Google signals y recopilación de datos proporcionados por usuarios. No agregar medición automática de enlaces, descargas o formularios.
4. Después de publicar, probar rechazo sin tráfico Google, aceptación con una vista, descarga y copia exitosa. Inspeccionar ausencia de PII y correlacionar hora/ruta/evento en tiempo real o DebugView. Una cola o HTTP 204 no prueban recepción en la propiedad.
5. Revisar adquisición por vocabulario aprobado y conteos tras la demora normal. Las dimensiones no garantizan informes retroactivos.

## SEO y publicación

- Comprobar respuestas 200, host/ruta canónicos, título/descripción, idiomas, robots y sitemap del despliegue real. Los redirects estáticos históricos deben apuntar al canonical actual y no entrar en sitemap.
- Confirmar propiedad en Search Console, enviar `https://apxagent.app/sitemap-index.xml`, inspeccionar inicio/comparativas y exclusiones. Requiere acceso administrativo real.
- `/best-ai-agent-apps/` responde 404: el artículo existente es `/compare/best-ai-agent-apps/` (y `/es/compare/best-ai-agent-apps/`). Usar esa ruta canónica en marketing, no promocionar el alias raíz.
- Compilar y chequear el workspace independiente de docs con base `/`, ejecutar pruebas de navegador y revisar diff final. Publicar por Pages sólo con autorización; este cambio del sitio no necesita release de la app.
