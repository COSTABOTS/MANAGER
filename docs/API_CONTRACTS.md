# Contratos API observados

## Resolución/configuración

- `GET /public-api/widget/resolve?slug=<slug>`: Assistant por compatibilidad.
- `GET /public-api/widget/resolve?slug=<slug>&type=booking`: Booking.
- `GET /public-api/widget/config?client_id=<id>&public_token=<token>`.
- Estados `SUSPENDED`/`EXPIRED` y tokens ausentes se rechazan.

Implementación: `routes/widgetResolve.ts` valida GET, slug `[a-z0-9-]+`, mapping fijo `assistant -> assistant_slug` y `booking -> booking_slug`, consulta `CLIENTES` con límite defensivo de dos filas y solo devuelve credenciales públicas de instalación. `routes/widgetConfig.ts` valida `client_id`/`public_token`, devuelve branding, servicios, horarios y límites; si `reservation_store` es `supabase`, obtiene datos de configuración desde el store SQL correspondiente.

## Disponibilidad/reservas

- `POST /availability/by-day`: fecha, servicio y credenciales.
- `POST /availability/by-hour`: fecha, pax, servicio y credenciales.
- `POST /reservation/create`: reserva estándar.
- `POST /reservation/balinese/availability`: disponibilidad Balinesa.
- `POST /reservation/balinese/create`: creación Balinesa.
- `POST /reservation/send-confirmation`: confirmación WhatsApp después de crear.
- Cancelación: `/reservation/cancellation/details` y `/confirm`.
- Feedback: `/feedback/details`, `/submit`, `/send-pending`.

Los shapes completos deben mantenerse en los tipos y tests del repositorio; esta auditoría no inventa campos ni reproduce secretos.

## Ejemplo sanitizado

```http
GET /functions/v1/public-api/widget/resolve?slug=zacs&type=booking
```

```json
{"ok":true,"client_id":"CB-ZACS-001","public_token":"[omitido]"}
```

El token mostrado aquí es deliberadamente omitido. Nunca registrar respuestas completas.
