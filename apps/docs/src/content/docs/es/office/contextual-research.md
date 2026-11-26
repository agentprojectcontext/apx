---
title: Investigación contextual
description: Investigá tus proyectos e intereses e incluí un hallazgo útil en un informe existente.
---

La investigación contextual es independiente de la revisión de actividad. La revisión propone mejoras desde conversaciones recientes; la investigación contextual lee fuentes públicas y busca una conexión útil con tus proyectos o intereses. Ninguna ejecuta sus sugerencias.

## Activala

La investigación empieza apagada. Instalar o actualizar APX no la activa ni cambia tus rutinas; solo completa lo que va a usar al empezar, así que activarla no te pregunta nada:

- todos tus proyectos registrados y legibles;
- la zona horaria de tu perfil;
- el informe diario de tu superagente, cuando hay una opción clara (su único informe, o su resumen de la mañana); si no, ninguno, y lo elegís vos;
- los límites por defecto.

Cuando la activás, tu superagente te ofrece una vez cargar tus intereses, páginas y ciudad o región con lo que ya sabe de vos. Te hace como mucho una pregunta si falta algo importante.

## Se completa mientras charlan

Con la investigación activa, tu superagente suma lo que aparece en la charla: un interés, un proyecto a seguir, una página pública oficial, tu ciudad o región. Lo hace sin cortar la charla ni pedir aprobación. La respuesta muestra una línea chica, **Se actualizó la investigación**; abrila para ver qué se sumó. Solo cuenta lo que decís vos: una rutina, un contacto u otro agente no pueden sumar nada, y una página encontrada en la web se suma solo cuando la das en un mensaje tuyo. Sumar nunca descarta lo que la investigación ya encontró.

Activarla o apagarla, su alcance y sus límites siguen pasando por una tarjeta de aprobación cuando los cambia tu superagente (`discovery.configure`). Con la investigación apagada, tu superagente no sabe nada de ella y no suma nada.

## Revisá y editá

En **Configuración › Investigación**, el interruptor de arriba la activa o la apaga al instante. Mientras está apagada, APX no busca nada y tu informe sale como siempre; al activarla aparece la configuración. Los cambios en la configuración quedan pendientes hasta que elegís **Guardar cambios**, que reinicia la investigación con lo nuevo; **Descartar** vuelve a lo guardado.

Podés revisar y cambiar:

- Todos los proyectos registrados y legibles, o una selección explícita.
- Páginas públicas oficiales para cada proyecto. Incluí secciones relevantes como precios, novedades o documentación. Los términos públicos de búsqueda son opcionales. APX no manda fragmentos privados de conversaciones ni hipótesis generadas a los buscadores.
- Intereses opcionales, expresados como términos que autorizás a buscar públicamente. Escribí un tema y presioná Enter, una coma o **Agregar**. Una sola ciudad o región opcional puede acotar esas búsquedas. APX no determina ni rastrea tu ubicación.
- Un intervalo de investigación profunda, inicialmente de dos días; límites de llamadas al modelo, operaciones web y tiempo; y un período para no repetir temas.
- Un informe global existente a cargo de tu superagente. El horario de entrega lo determina la rutina del informe: elegirla no la mueve a las 9:00. Pedí cambiar esa rutina si querés otra hora u otros días. Si tu superagente todavía no tiene un informe, creá uno primero en Rutinas.

La investigación usa la zona horaria de tu perfil (**Configuración › Cuenta**) para decidir qué cuenta como un día. Si tu perfil no tiene una, usa la zona propia de la investigación, UTC salvo que tu superagente la haya cambiado.

Podés permitir por separado conversaciones y decisiones autorizadas, sitios públicos mencionados en el contexto de los proyectos y noticias sobre intereses. La opción de sitios parte de los orígenes HTTPS ya referenciados en los proyectos elegidos; no publica sus preguntas privadas como búsquedas. También podés agregar secciones oficiales concretas. Que un sitio esté mencionado no lo convierte automáticamente en una fuente oficial.

Cada pasada diaria explora el contexto de todos los proyectos elegibles. Después, consultas privadas acotadas al modelo descubren preguntas concretas, rotando entre proyectos en lugar de mirar únicamente tareas recientes. Cada pregunta se elige para que puedan responderla las páginas oficiales que indicaste para ese proyecto. La investigación pública tiene su propia cobertura progresiva: la configuración distingue proyectos explorados, preguntas analizadas y fuentes consultadas. Una lista grande puede requerir varias pasadas dentro de tus límites.

La investigación usa el modelo ayudante (**Configuración › Modelo ayudante**). No agrega dependencias, sesiones privilegiadas de navegador, acciones sobre dispositivos ni cambios automáticos en proyectos. Las páginas públicas usan las mismas protecciones de red que la lectura web. Cada redirección se comprueba antes de conectar: las páginas de un proyecto permanecen en los orígenes autorizados y no pueden redirigir a URLs con parámetros de consulta. Una operación de búsqueda puede intentar hasta tres buscadores; sus fragmentos de resultados nunca se usan como evidencia.

## Qué llega al informe

APX guarda un conjunto acotado de hallazgos con URLs, citas exactas de respaldo, fecha de lectura, incertidumbre y un próximo paso sugerido. Incluye como máximo un hallazgo en el informe elegido por fecha del calendario local, sin crear un segundo informe.

Los días intermedios puede incluir un hallazgo todavía vigente que no haya usado antes. Si no hay un hallazgo respaldado, el informe no lleva un tema de investigación: APX no rellena con un tema débil ni repite el de ayer. Tu informe habitual sigue funcionando.

Las fuentes inaccesibles o ilegibles quedan registradas, no se toman como evidencia. Una página que necesita JavaScript o inicio de sesión puede seguir siendo ilegible para esta comprobación en segundo plano. La investigación es acotada y no constituye una auditoría exhaustiva de la web ni de tu código. Las citas exactas muestran de dónde salió la evidencia. Otra consulta al modelo comprueba respaldo, relevancia y novedad antes de aceptar un hallazgo; la interpretación todavía puede ser incorrecta. Tanto la propuesta como su verificación cuentan para el límite de llamadas al modelo. El mínimo es de tres llamadas; la investigación profunda reserva dos para proponer y comprobar un hallazgo aunque las preguntas de los proyectos sigan cambiando. La indisponibilidad de los buscadores se registra por separado de una búsqueda que respondió sin resultados.

Marcá un hallazgo como útil o no útil para influir en futuras selecciones, o silenciá su tema. Podés valorar un hallazgo en Investigación o responder en el chat del informe; confirmá el cambio si APX te lo pide. Las preferencias y los registros para evitar repeticiones persisten. La sección Temas silenciados permite deshacer un silencio incluso después de que un cambio de configuración haya descartado el hallazgo guardado. Cambiar la autorización de fuentes descarta hallazgos guardados; desactivar la investigación detiene trabajo futuro sin borrar ni reprogramar el informe elegido.

## Fiabilidad y privacidad

Un proyecto debe seguir registrado, legible y dentro del alcance elegido para aportar un hallazgo. Las referencias se preparan por proyecto; la investigación no manda conversaciones de un proyecto a la consulta de otro. Las búsquedas usan únicamente términos públicos, intereses y ubicación opcional configurados explícitamente.

El trabajo en segundo plano tiene un plazo máximo y guarda su resultado. Una solicitud interrumpida no se repite silenciosamente al reiniciar. La inclusión se reserva dentro de la transacción de admisión del informe, por lo que una admisión fallida no consume el hallazgo. El core agrega el hallazgo elegido al informe terminado, o a su primer mensaje al dueño si la rutina envía el informe por su cuenta; no depende de que el modelo repita un agregado al prompt. Un informe base sin novedades puede llevar solo el hallazgo. Un fallo o una cancelación no generan otro mensaje de investigación; si la rutina envía el informe por su cuenta, conserva su entrega inmediata habitual. Una vez admitido, un informe fallido o silenciado no vuelve a incluir automáticamente ese hallazgo en otro informe. La reserva y la composición se registran por separado; ninguna prueba que un canal externo haya entregado el informe.
