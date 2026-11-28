---
title: Recados en el camino
description: Mientras manejás, APX busca un lugar para tus recados cerca del camino y te pregunta en el auto si querés ir.
---

Los recados son las cosas chicas que hacés cuando salís: comprar leche, retirar un paquete, sacar plata. Prendé **En
el auto** y APX los tiene en cuenta mientras manejás. Cuando pasás cerca de un lugar donde se puede hacer alguno, te
avisa en la pantalla del auto, en el celular y en el panel, y contestás con un toque o con la voz.

Empieza apagado. Hasta que lo prendas, el celular no corre nada en segundo plano y APX no busca nada.

## Qué necesitás

- La app de APX en un celular Android, emparejada con tu APX ([Tu celular](/es/devices/phone/)). Funciona igual
  cuando APX corre en un servidor: el celular le habla con su propia clave y la app no tiene que estar abierta.
- Android Auto en el auto, o Google Maps navegando: cualquiera de los dos le dice a APX que estás manejando.

## Prenderlo

1. Abrí **Ajustes › En el auto** en el celular o la computadora y activá **Recados en todos los teléfonos**.
2. En cada Android que deba participar, activá **Usar este teléfono para recados**. Los dos interruptores son independientes y empiezan apagados. **Ajustes › Privacidad › Ubicación durante viajes** también debe permitir compartirla.
3. Permití lo que pide la lista, un toque cada uno: **Leer notificaciones** (así APX ve que se conectó Android Auto o
   que Maps empezó una ruta), **Ubicación** y **Notificaciones**.
4. Probalo sin manejar: **Probar sin auto** empieza un viaje de prueba desde donde estás.

Apagá **Recados en todos los teléfonos** desde cualquiera de las dos apps para detenerlos en todas partes, o **Usar este teléfono para recados** para detener solo ese teléfono. Si pierde conexión, el teléfono pausa su GPS después de una comprobación de seguridad fallida y requiere que lo vuelvas a habilitar ahí. El corte remoto de GPS necesita el core y el APK en 2.18.1 o posterior; un APK anterior puede seguir usando GPS aunque el core actualizado descarte las posiciones. Mirá [Privacidad y telemetría](/es/reference/privacy/#la-ubicación-del-teléfono-se-elige-por-separado) para los límites de tiempo y compatibilidad.

En el panel, **Ajustes › En el auto** tiene el resto: con cuánta anticipación querés enterarte de un lugar, de dónde
salen los lugares y si también querés el aviso en tu chat (Telegram, WhatsApp…).

:::note[Una app que no se instaló desde Play Store]
Android Auto muestra la app de APX en el auto solo con **Fuentes desconocidas** activado en la configuración de
desarrollador de Android Auto (abrí la configuración de Android Auto, tocá **Versión** diez veces y después el menú ›
**Configuración para desarrolladores**).
:::

## Los recados y dónde se hacen

Un recado dice en qué tipo de lugar se hace: **Supermercado**, **Farmacia**, **Librería**, **Ferretería**,
**Cajero**, **Retiro de paquetes**, etc. Cuando le pedís uno a un agente ("recordame comprar papas fritas"), él elige
el tipo de lugar; en el formulario de la tarea podés cambiarlo, sumar una marca o cadena ("La Anónima") o fijar un
lugar ("el correo de la calle Mitre").

Algo que se vende en varios tipos de negocio lleva todos, el mejor primero: las pilas son **Supermercado**,
**Kiosco**, **Electrónica**.

## Mientras manejás

Cuando adelante tuyo, lo bastante cerca, hay un lugar para un recado, APX te lo ofrece una vez por recado y por viaje:

| Respuesta | Qué pasa |
|---|---|
| **Voy** | Google Maps te lleva. |
| **Sumar parada** | Maps lo agrega en el camino a donde vas. |
| **Otro lugar** | APX busca el siguiente para el mismo recado y no te vuelve a ofrecer este en el viaje. |
| **Más tarde** | Espera un rato (15 minutos o 3 km) y te lo vuelve a ofrecer. |
| **No en este viaje** | Ese recado espera al próximo viaje. |
| **No me avises más** | No hay más avisos hasta que el auto se vuelva a conectar. |
| **Ya lo hice** | El recado se cierra. |

En el auto, la app de APX lista los avisos y tus recados abiertos, y tiene una fila para hablar con tu superagente.
Sin abrirla, los avisos también llegan como mensajes que Android Auto lee en voz alta; contestá con la voz: "voy",
"otro", "después", "no", "ya está", "no me avises más". Cualquier otra cosa que digas le llega a tu superagente, y su
respuesta te la lee.

Mientras manejás, tu superagente contesta corto, y con **Responder con voz mientras manejo** sus respuestas en tu chat
empiezan con un audio.

## Lugares que usás

Cada respuesta le enseña a APX sobre el lugar: los que elegís salen primero la próxima vez, los que rechazás bajan.
**Ajustes › En el auto › Lugares que usás** los lista; marcá uno como **Siempre este** o **Nunca**, u olvidalo.

## De dónde salen los lugares

- **OpenStreetMap** (por defecto): gratis, sin clave. Los lugares se guardan una semana, así un viaje hace pocas
  búsquedas. La mayoría de los negocios en OpenStreetMap no tienen cargado el horario, así que "abierto ahora" muchas
  veces no se sabe.
- **Google**: sumá tu propia clave de Google Maps Platform (Places API) para más cobertura, abierto ahora y
  calificaciones. Google pide facturación en tu proyecto aunque el uso sea gratis; los recados de una persona entran en
  las cantidades gratis del mes, y podés poner un tope diario en la consola de Google para que nunca se cobre nada.

Tu posición va solo a tu APX: un punto por vez mientras dura el viaje, nunca un historial.
