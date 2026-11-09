# Blog editorial

El blog es parte estática del sitio de marketing en `/blog/` y `/es/blog/`, separado de la documentación y las comparativas. Comparte cabecera, pie, tema, consentimiento y metadatos. No incorpora CMS, Analytics adicional, métodos del core ni dependencias. Estas rutas son trabajo de desarrollo hasta su integración y despliegue por separado.

## Agregar un artículo

Escribí archivos Markdown emparejados en `src/content/blog/en/` y `src/content/blog/es/`, con el mismo slug. La colección valida los metadatos; la publicación falla si un artículo no borrador carece de traducción no borrador o repite slug/idioma. Los borradores no generan entradas, rutas ni sitemap. Las fechas son fechas de calendario UTC explícitas, no cambios del archivo. El blog puede estar vacío; no presenta comparativas existentes como investigación nueva.

```yaml
---
title: Un título descriptivo del artículo
description: Un resumen claro de menos de 160 caracteres.
lang: es
slug: article-topic
draft: true
published: "2026-01-01"
sources:
  - label: Una fuente primaria específica
    url: https://example.com/research/topic
    checked: "2026-01-01"
---
```

Traducí título, descripción y cuerpo; usá `lang: en` en el archivo inglés. El campo opcional `updated` no puede ser anterior a `published`. Cambiá ambos archivos a `draft: false` solo después de la aprobación editorial. El detalle muestra Markdown y fuentes enlazadas. Canonical, alternativas de idioma, metadatos de artículo y sitemap usan `DOCS_SITE` y `DOCS_BASE`.

## Imágenes y layout compartido

Todos los listados y artículos usan `src/components/blog/BlogPage.astro` y `blog.css`. Un rediseño ahí se aplica a todas las páginas, sin editar cada Markdown. El sitio utiliza CSS Astro compartido; no agregamos Tailwind ni otro stack de estilos.

Guardá las imágenes locales en `src/assets/blog/<slug>/`, no en `public/`, para que Astro valide el archivo, lea sus dimensiones reales y genere variantes WebP. Agregá este frontmatter opcional en cada idioma:

```yaml
image:
  src: ../../../assets/blog/article-topic/hero.webp
  alt: Una descripción localizada de lo que muestra la ilustración.
  caption: Ilustración conceptual, no una captura de pantalla.
```

La ruta es relativa a un Markdown en `src/content/blog/en/` o `es/`. Ambos idiomas pueden compartir el recurso; traducí el alt y el pie. El alt no puede estar vacío. No hace falta indicar width/height: Astro lee las dimensiones del original. Preferí banners de 1600 × 900 con dirección visual consistente y sin texto incrustado. El layout usa `srcset`, `sizes`, dimensiones explícitas, portada de carga prioritaria y miniaturas de carga diferida, sin ampliar originales chicos. La portada también se usa para compartir el artículo y en sus datos estructurados; sin portada se mantiene la imagen localizada del sitio.

Para imágenes dentro del artículo, usá Markdown con alt descriptivo y rutas relativas a la misma carpeta de recursos. Priorizá capturas reales y actuales de APX para explicar recorridos existentes; no presentes banners generados como capturas. Verificá los derechos de los recursos y distinguí ilustraciones conceptuales de interfaces reales mediante el pie. No commitees imágenes de verificación ni artículos de muestra.

La cabecera compartida del artículo ubica la portada antes del título y resumen, con una separación compacta debajo de la navegación fija. Los artículos conservan una columna de lectura acotada; este layout no requiere cambios por artículo.

## Navegación del archivo

El archivo muestra diez artículos publicados por página, del más reciente al más antiguo, en el idioma elegido. La primera página sigue en `/blog/` (`/es/blog/`); las siguientes usan `/blog/page/2/` y `/es/blog/page/2/`. Los enlaces anterior/siguiente, el cambio de idioma, las URL canónicas, las alternativas de idioma y el sitemap conservan el número de página. Solo se generan páginas con artículos. El menú Blog del encabezado muestra hasta cuatro artículos publicados recientes, nunca borradores.

Para verificar la paginación, compilá con más de diez artículos bilingües descartables y ejecutá `node scripts/blog-pagination.browser.mjs` contra el preview. Eliminá todos los fixtures y recompilá antes de publicar. `node scripts/blog-navigation.browser.mjs` comprueba la navegación y los estados activos del encabezado en escritorio y teléfono.

## Investigación y aprobación

Coordiná temas, intención de búsqueda y publicación con el trabajo SEO existente. Cada afirmación necesita evidencia relevante y revisada; exigir una fuente en los metadatos no certifica el texto. Diferenciá el relato de un usuario de una limitación reproducible. Indicá versión, fecha y contexto; no generalices una queja aislada ni inventes estrellas, citas, métricas o capacidades. Evitá identificadores personales de reseñas. Priorizá incidencias primarias, documentación y observaciones reproducibles. Explicá cuándo APX sirve y cuándo no con capacidades verificadas. No publiques investigación sin aprobar ni presentes comparativas existentes como quejas recién investigadas.

La conversión de reels a artículos queda para trabajo editorial posterior; esta implementación no transcribe ni publica automáticamente.

## Verificación y despliegue

Ejecutá instalación congelada, build y checks independientes desde `apps/docs` con `DOCS_BASE=/` y `/apx/`. Probá un artículo bilingüe temporal y un borrador, incluidas fuentes, Markdown, cambio de idioma y exclusión del sitemap, sin versionar ejemplos editoriales. Revisá escritorio y teléfono. La publicación es independiente: este cambio no modifica Pages ni autoriza push, release o deploy.

Las pruebas de navegador se ejecutan con `node scripts/blog.browser.mjs` desde la carpeta del sitio (Playwright viene del workspace raíz). Definí `DOCS_TEST_URL` con la vista previa en ejecución, incluido `/apx` cuando corresponda. Para probar un artículo bilingüe descartable, definí `DOCS_TEST_ARTICLE_SLUG` con su slug; mantené un borrador llamado `unpublished-draft` para probar el caso negativo. Para el recurso descartable de portada de 1600 × 900, definí además `DOCS_TEST_IMAGE=1` y verificá variantes responsive, carga real de imagen, pie y dimensiones de la vista previa social. `DOCS_TEST_OUTPUT` indica una carpeta temporal para capturas. Las pruebas cubren lectura, fuentes, fechas, cambio de idioma, temas, menú móvil, superposición del encabezado, sitemap y exclusión de borradores. Probá por separado el sitio vacío sin la variable del slug. Nunca agregues artículos de verificación a un build de producción.

Docs impact: updated — esta guía y su versión inglesa documentan preparación de artículos, publicación bilingüe explícita, requisitos de evidencia y límites del despliegue.
