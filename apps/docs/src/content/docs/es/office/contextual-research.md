---
title: Investigación contextual
description: Investigá tus proyectos e intereses e incluí un hallazgo útil en un informe existente.
---

La investigación contextual es independiente de la revisión de actividad. La revisión propone mejoras desde conversaciones recientes; la investigación contextual lee fuentes públicas y busca una conexión útil con tus proyectos o intereses. Ninguna ejecuta sus sugerencias.

## Configurá antes de activar

Pedile a tu superagente que te ayude a configurar la investigación. Puede proponer cambios mediante `apx_settings`, con `discovery.configure`; cambiar la configuración siempre tiene una tarjeta de aprobación. Instalar la función no activa la investigación ni cambia rutinas existentes.

Elegí:

- Todos los proyectos registrados y legibles, o una selección explícita.
- Páginas públicas oficiales para cada proyecto. Incluí secciones relevantes como precios, novedades o documentación. Los términos públicos de búsqueda son opcionales. APX no manda fragmentos privados de conversaciones ni hipótesis generadas a los buscadores.
- Intereses opcionales, expresados como términos que autorizás a buscar públicamente. Una ciudad o región opcional puede acotar esas búsquedas. APX no determina ni rastrea tu ubicación.
- Un intervalo de investigación profunda, inicialmente de dos días; límites de llamadas al modelo, operaciones web y tiempo; y un período para no repetir temas.
- Un informe global existente a cargo de tu superagente y tu zona horaria. El horario de entrega lo determina la rutina del informe: elegirla no la mueve a las 9:00. Pedí cambiar esa rutina si querés otra hora u otros días.

Podés permitir por separado conversaciones y decisiones autorizadas, sitios públicos mencionados en el contexto de los proyectos y noticias sobre intereses. La opción de sitios parte de los orígenes HTTPS ya referenciados en los proyectos elegidos; no publica sus preguntas privadas como búsquedas. También podés agregar secciones oficiales concretas. Que un sitio esté mencionado no lo convierte automáticamente en una fuente oficial.

Cada pasada diaria explora el contexto de todos los proyectos elegibles. Después, consultas privadas acotadas al modelo descubren preguntas concretas, rotando entre proyectos en lugar de mirar únicamente tareas recientes. La investigación pública tiene su propia cobertura progresiva: la configuración distingue proyectos explorados, preguntas analizadas y fuentes consultadas. Una lista grande puede requerir varias pasadas dentro de tus límites.

La investigación usa el modelo auxiliar. No agrega dependencias, sesiones privilegiadas de navegador, acciones sobre dispositivos ni cambios automáticos en proyectos. Las páginas públicas usan las mismas protecciones de red que la lectura web. Cada redirección se comprueba antes de conectar: las páginas de un proyecto permanecen en los orígenes autorizados y no pueden redirigir a URLs con parámetros de consulta. Una operación de búsqueda puede intentar hasta tres buscadores; sus fragmentos de resultados nunca se usan como evidencia.

## Qué llega al informe

APX guarda un conjunto acotado de hallazgos con URLs, citas exactas de respaldo, fecha de lectura, incertidumbre y un próximo paso sugerido. Incluye como máximo un hallazgo en el informe elegido por fecha del calendario local, sin crear un segundo informe.

Los días intermedios puede incluir un hallazgo todavía vigente que no haya usado antes. Si no hay un hallazgo respaldado, el informe no lleva un tema de investigación: APX no rellena con un tema débil ni repite el de ayer. Tu informe habitual sigue funcionando.

Las fuentes inaccesibles o ilegibles quedan registradas, no se toman como evidencia. Una página que necesita JavaScript o inicio de sesión puede seguir siendo ilegible para esta comprobación en segundo plano. La investigación es acotada y no constituye una auditoría exhaustiva de la web ni de tu código. Las citas exactas muestran de dónde salió la evidencia. Otra consulta al modelo comprueba respaldo, relevancia y novedad antes de aceptar un hallazgo; la interpretación todavía puede ser incorrecta. Tanto la propuesta como su verificación cuentan para el límite de llamadas al modelo. El mínimo es de tres llamadas; la investigación profunda reserva dos para proponer y comprobar un hallazgo aunque las preguntas de los proyectos sigan cambiando. La indisponibilidad de los buscadores se registra por separado de una búsqueda que respondió sin resultados.

Marcá un hallazgo como útil o no útil para influir en futuras selecciones, o silenciá su tema. Podés valorar un hallazgo en Investigación o responder en el chat del informe; confirmá el cambio si APX te lo pide. Las preferencias y los registros para evitar repeticiones persisten. La sección Temas silenciados permite deshacer un silencio incluso después de que un cambio de configuración haya descartado el hallazgo guardado. Cambiar la autorización de fuentes descarta hallazgos guardados; desactivar la investigación detiene trabajo futuro sin borrar ni reprogramar el informe elegido.

## Fiabilidad y privacidad

Un proyecto debe seguir registrado, legible y dentro del alcance elegido para aportar un hallazgo. Las referencias se preparan por proyecto; la investigación no manda conversaciones de un proyecto a la consulta de otro. Las búsquedas usan únicamente términos públicos, intereses y ubicación opcional configurados explícitamente.

El trabajo en segundo plano tiene un plazo máximo y guarda su resultado. Una solicitud interrumpida no se repite silenciosamente al reiniciar. La inclusión se reserva dentro de la transacción de admisión del informe, por lo que una admisión fallida no consume el hallazgo. El core agrega el hallazgo elegido al informe terminado, o a su primer mensaje al dueño si la rutina envía el informe por su cuenta; no depende de que el modelo repita un agregado al prompt. Un informe base sin novedades puede llevar solo el hallazgo. Un fallo o una cancelación no generan otro mensaje de investigación; si la rutina envía el informe por su cuenta, conserva su entrega inmediata habitual. Una vez admitido, un informe fallido o silenciado no vuelve a incluir automáticamente ese hallazgo en otro informe. La reserva y la composición se registran por separado; ninguna prueba que un canal externo haya entregado el informe.
