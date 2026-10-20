# Catálogo de funciones — investigación de apps de referencia

> Fase 1 del proyecto **Kuenta**: PWA de finanzas personales, local, sin servidor.
> Fecha de la investigación: octubre de 2026.

## Fuentes revisadas

| App | Licencia | Plataforma | Qué se revisó |
|---|---|---|---|
| [Actual Budget](https://github.com/actualbudget/actual) | MIT | Web/escritorio, local-first con sincronización opcional | README, documentación (tour, schedules, budgeting) y demo en tamaño móvil (presupuesto, cuentas, nuevo movimiento) |
| [Sure](https://github.com/we-promise/sure) (fork de Maybe) | AGPL-3.0 | Web autoalojada (Rails) | README, web, demo en móvil (inicio, movimientos, presupuestos) |
| [Securo](https://github.com/securo-finance/securo) | AGPL-3.0 | Web autoalojada (FastAPI + React) | README, documentación, demo en móvil (inicio, movimientos, presupuestos, informes) |
| [Firefly III](https://github.com/firefly-iii/firefly-iii) | AGPL-3.0 | Web autoalojada (Laravel) | README y documentación de conceptos (la demo bloquea navegadores automatizados) |
| [ezBookkeeping](https://github.com/mayswind/ezbookkeeping) | MIT | Web autoalojada (Go + Vue), PWA | README, lista completa de funciones, demo móvil (inicio, alta de movimiento, estadísticas) |
| [MyExpenses](https://github.com/mtotschnig/MyExpenses) | GPL-3.0 | Android nativo | README, web oficial y registro de cambios |
| [Cashew](https://github.com/jameskokoska/Cashew) | GPL-3.0 | Flutter (Android, iOS, web) | README y guía/FAQ oficial |
| [Tallybook](https://github.com/herrerad85/tallybook) (fork de MoneyWallet) | GPL-3.0 | Android nativo | README y FAQ |

**Nota sobre licencias.** Sure, Securo y Firefly III son AGPL; MyExpenses, Cashew y Tallybook, GPL. Actual y ezBookkeeping son MIT. En todos los casos se han usado **solo como inspiración de funciones y de diseño**: no se copia código, iconos, textos ni recursos gráficos de ninguna de ellas.

Leyenda de apps en la tabla: **A** Actual · **Su** Sure · **Se** Securo · **F** Firefly III · **E** ezBookkeeping · **M** MyExpenses · **C** Cashew · **T** Tallybook.

La complejidad es la estimada **para Kuenta** (PWA local con IndexedDB), no la que tuvo en la app original.

---

## 1. Tabla de funciones

### Movimientos y cuentas

| Función | Apps | Complejidad | Comentario |
|---|---|---|---|
| Gastos e ingresos manuales | todas | Baja | Núcleo de la app. |
| Varias cuentas con saldo inicial y saldo actual | todas | Baja | El saldo se calcula: saldo inicial + suma de movimientos. |
| Tipos de cuenta (efectivo, banco, tarjeta, ahorro) | A, Su, Se, F, E, M, T | Baja | Solo cambia el icono y la agrupación. |
| Transferencias entre cuentas | todas | Media | Hay que garantizar que no cuenten como gasto ni ingreso en los informes. |
| Archivar u ocultar cuentas | A, F, E | Baja | Las cuentas archivadas siguen contando en el histórico. |
| Movimientos futuros o pendientes (no cuentan hasta "pagarlos") | C, Su, A | Media | Añade un estado al movimiento y lo complica en todos los cálculos. |
| Estado punteado o conciliado | A, M, E, F | Media | Útil sobre todo con extractos bancarios. |
| Movimientos divididos en varias categorías | A, F, M, Su | **Alta** ⚠️ | Un movimiento pasa a tener N líneas; afecta a saldos, informes, presupuestos, CSV y edición. |
| Multimoneda con tipos de cambio | Su, Se, F, E, M, C, T | **Alta** ⚠️ | Cada importe necesita moneda; totales y gráficos necesitan conversión, y los tipos de cambio requieren un servicio externo o introducirlos a mano. |
| Partida doble (cuentas de gasto/ingreso como cuentas reales) | F | **Alta** ⚠️ | Modelo contable completo; muy potente pero pesado para uso diario en el móvil. |
| Tarjeta de crédito con fecha de corte y límite | E | Media | |
| Deudas y préstamos (me deben / debo) | C, T, Se, Su | Media | |
| Adjuntar foto del ticket | E, M | Media-alta | Las imágenes engordan IndexedDB y las copias JSON. |
| Ubicación del movimiento | E, A | Media | Requiere permiso de geolocalización; poco valor. |

### Organización

| Función | Apps | Complejidad | Comentario |
|---|---|---|---|
| Categorías personalizables con icono y color | todas | Baja | Con un juego inicial en español. |
| Subcategorías (dos niveles) | E, T, M, A (grupos) | Media | Afecta a gráficos (agregar por padre) y presupuestos. |
| Etiquetas (varias por movimiento) | F, M, E, Su, A | Media | Relación N:M; filtros y CSV deben soportarlas. |
| Beneficiarios o comercios | A, Su, Se, M | Media | Útil para autocompletar y reglas. |
| Notas en el movimiento | todas | Baja | |
| Búsqueda y filtros (texto, fecha, cuenta, categoría, importe) | todas | Media | |
| Edición o borrado múltiple | C, E | Media | |

### Automatización

| Función | Apps | Complejidad | Comentario |
|---|---|---|---|
| Movimientos recurrentes (diario, semanal, mensual, anual) | A, Se, F, E, M, C, T | Media | Sin servidor: se generan al abrir la app ("ponerse al día"). Casos difíciles: día 31, años bisiestos, no duplicar. |
| Suscripciones con aviso de próximo cargo | C, F | Media | Es un recurrente con vista de "próximos". |
| Plantillas o favoritos (registrar con un toque) | M, E, C (fijados) | Baja | Muy rentable para gastos frecuentes (café, gasolina). |
| Autocompletar por título o beneficiario (sugiere categoría y cuenta) | C, M, A | Baja | Se deduce del historial; no necesita tablas nuevas. |
| Reglas de categorización automática | A, F, Su, Se, E | Alta | Solo tiene sentido de verdad si hay importación de extractos. |
| Importar extractos (CSV, OFX, QIF) | A, Su, Se, F, E, M, C, T | Alta | Cada banco exporta un CSV distinto: hace falta mapeo de columnas, formatos de fecha y detección de duplicados. |
| Sincronización bancaria | A, Su, Se, F | — | Requiere servidores y proveedores externos. Incompatible con los requisitos. |
| Reconocimiento con IA u OCR de tickets | E, M, Su, Se | — | Requiere servicios externos. |
| Notificaciones | C, M | Alta | Una PWA sin servidor no puede programar avisos fiables con la app cerrada. |

### Análisis

| Función | Apps | Complejidad | Comentario |
|---|---|---|---|
| Inicio con saldo total y resumen del mes | todas | Baja | |
| Gasto por categoría (dónut o tarta) | E, M, C, Se, Su, F | Baja | |
| Ingresos frente a gastos por mes (barras) | A, Se, F, E, C, Su | Baja | |
| Tasa de ahorro del mes | Se | Baja | (ingresos − gastos) / ingresos. |
| Previsión de gasto a final de mes ("a este ritmo…") | Se, C (línea de ritmo) | Baja | |
| Evolución del saldo o patrimonio | Su, Se, A, M, E | Media | Hay que reconstruir saldos por fecha. |
| Presupuesto mensual por categoría | A, Su, Se, F, M, C, T | Media | Límite por categoría y mes; progreso y avisos de exceso. |
| Presupuesto por sobres con arrastre de saldo (método de Actual) | A | **Alta** | Cambia la filosofía de la app: hay que repartir cada ingreso. |
| Objetivos de ahorro (huchas) | F, Se, C, T | Media | |
| Comparación con periodos anteriores | E, C, Se | Media | |
| Calendario o mapa de calor de gasto | C, T, E | Media | |
| Diagrama de flujo (Sankey) | E, Se | Alta | Vistoso, poco útil en una pantalla de móvil. |
| Informes personalizados o explorador de datos | E, A | Alta | |
| Inversiones y activos con valoración | Su, Se | Alta | Fuera del objetivo. |

### Datos

| Función | Apps | Complejidad | Comentario |
|---|---|---|---|
| Exportar movimientos a CSV | Se, E, M, T, F, A | Baja | **Obligatorio.** Con `;` como separador y coma decimal para que Excel en español lo abra bien. |
| Copia completa y restauración (JSON) | A, M, C, T, F | Baja-media | **Obligatorio.** Validar versión y estructura antes de sustituir nada. |
| Compartir la copia (Drive, correo, Telegram…) con el menú nativo | — (idea propia vía Web Share API) | Baja | En Android abre el menú "Compartir" del sistema; ningún servidor nuestro de por medio. |
| Recordatorio de "haz una copia" | T (copia automática), C | Baja | Aviso en la app si han pasado N días desde la última exportación. |
| Copia cifrada con contraseña | M | Media | WebCrypto (AES-GCM). |
| Copia automática a la nube (Drive, WebDAV) | C, M, T | Alta | Requiere integrar servicios externos. |
| Sincronización entre dispositivos | A, C | Alta | Requiere servidor. |

### Extras

| Función | Apps | Complejidad | Comentario |
|---|---|---|---|
| Tema claro / oscuro | A, Su, Se, E, M, C, T | Baja | Con variables CSS; se decide al principio. |
| Modo privacidad (ocultar importes con un "ojo") | A, Su, Se, E | Baja | Muy útil en el móvil en público. |
| Bloqueo con PIN o biometría | E, M, C, T | Media | En una PWA es disuasorio, no seguridad real, salvo que se cifren los datos (alta). |
| Calculadora en el campo de importe | M, C | Baja | "12,5 + 3" directamente en el teclado. |
| Accesos directos desde el icono (mantener pulsado → "Nuevo gasto") | M, C, T (widgets) | Baja | `shortcuts` del manifest de la PWA. Los widgets de verdad requieren app nativa. |
| Color de acento personalizable | C, M | Baja | |
| Multiusuario, 2FA, OIDC | Su, Se, F, E | — | No aplica: sin cuentas de usuario. |
| Asistente con IA | Su, Se, E | — | Servicio externo. |
| Varios idiomas | todas | Media | Solo español en esta versión. |

---

## 2. Detalles de interfaz que merece la pena imitar

### Registro rápido de un gasto

- **Actual (móvil):** pantalla "Nuevo movimiento" con el **importe grande y centrado** arriba, y debajo Beneficiario, Categoría, Cuenta, Fecha (prefijada a hoy) y Notas. El botón inferior **cambia su texto según lo que falta** ("Selecciona una cuenta") hasta que el formulario es válido: guía sin mensajes de error.
- **ezBookkeeping (móvil):** importe enorme coloreado según el tipo, y **categoría y cuenta ya rellenadas con las últimas usadas**. Lo habitual es teclear el importe y guardar.
- **Cashew:** botón (+) que lanza una secuencia de pasos (título → categoría → importe) que el usuario puede reordenar o desactivar. Al escribir un título, **sugiere la categoría** usada antes con ese título. Permite **fijar movimientos** para duplicarlos con un toque.
- **MyExpenses:** **calculadora** integrada en el importe, "guardar y crear otro", **plantillas** y autocompletado a partir del último movimiento del mismo beneficiario.

**Propuesta para Kuenta:** una **hoja inferior** (bottom sheet) que se abre desde un botón (+) central y siempre visible:
1. Selector Gasto / Ingreso / Transferencia (gasto por defecto).
2. Importe grande con **teclado numérico propio** (coma decimal, `+`/`−` para sumar tickets), sin abrir el teclado del sistema.
3. Fila de **categorías recientes** como iconos de color, con "Ver todas".
4. Cuenta prefijada con la última usada; fecha como chips **Hoy · Ayer · Otra**.
5. Nota opcional que **autocompleta** y sugiere categoría.
6. Botón Guardar grande al alcance del pulgar.

Objetivo: **importe + 1 toque de categoría + Guardar** para el caso típico.

### Navegación

- **Actual móvil:** barra inferior con solo 3 destinos (Presupuesto, Movimiento, Cuentas).
- **ezBookkeeping y Sure:** barra inferior de 5 elementos; en ezBookkeeping el **(+) va en el centro**.
- **Cashew:** pestañas inferiores configurables y una página "Más" para lo secundario.
- **Securo:** en móvil usa un menú hamburguesa con una docena de entradas. Es **el ejemplo a evitar**: todo queda a dos toques y lejos del pulgar.
- **Selector de mes `‹ octubre 2026 ›`** (Actual, Securo, Sure): mismo control en todas las pantallas que dependen de un periodo.

**Propuesta:** barra inferior con **Inicio · Movimientos · (+) · Análisis · Más**. Cuentas, Categorías, Recurrentes, Copias y Ajustes cuelgan de "Más" o de Inicio.

### Listas de movimientos

- **Sure:** agrupados por día con cabecera "20 OCT 2026 · 1 movimiento · −8,00" (fecha, recuento y **total del día**).
- **MyExpenses:** agrupación por día, semana, mes o año con sumas por grupo.
- Fila típica: **círculo con el icono y color de la categoría**, título y categoría o cuenta en gris debajo, importe alineado a la derecha; ingresos en verde y gastos en color neutro (no rojo: si casi todo es gasto, una lista roja agobia).
- Deslizar para borrar o duplicar (Cashew), con "Deshacer" en un aviso temporal en vez de diálogos de confirmación.

### Inicio

- **Securo:** tarjeta con **tasa de ahorro**, ingresos y gastos del mes y la frase "a este ritmo gastarás X a final de mes". Es muy clara.
- **ezBookkeeping:** filas Hoy / Esta semana / Este mes / Este año con ingreso y gasto de cada periodo.
- **Actual:** aviso destacado "Tienes 3 categorías por encima del presupuesto".
- **Sure, Securo, Actual, ezBookkeeping:** **icono de ojo** para ocultar importes.

### Gráficos

- **ezBookkeeping:** dónut a pantalla completa con el **total en el centro**; flechas ‹ › o toque para recorrer categorías mostrando nombre, importe y porcentaje; conmutador Tarta / Barras. Funciona muy bien en el móvil porque no depende de leyendas diminutas.
- **Sure (presupuestos):** anillo con "Gastado 2.804 € **de** 431 €" en el centro, y tarjetas por categoría filtrables por "Excedido / En camino".
- **Cashew (presupuestos):** barra de progreso con una **marca de "hoy"** que muestra si vas por encima o por debajo del ritmo del mes.
- **Securo:** minigráficos (sparklines) por categoría en los informes.
- **Actual:** tabla de presupuesto con importes negativos en rojo; densa pero legible.

**Propuesta:** pocos gráficos y legibles: dónut por categoría con total central y lista debajo (la lista hace de leyenda), barras de ingresos frente a gastos de los últimos 6 o 12 meses, y barras de progreso de presupuesto con marca de ritmo.

---

## 3. Propuesta inicial de alcance

Criterio: una app **pequeña y terminada**, que se use a diario en el móvil y no pierda datos. Todo lo que obligue a cambiar el modelo de datos más adelante se decide ahora; lo que solo añade pantallas puede esperar.

### Entra en la versión 1

- Cuentas (efectivo, banco, tarjeta, ahorro) con saldo inicial, saldo calculado y archivado.
- Gastos, ingresos y **transferencias** entre cuentas.
- Categorías de gasto e ingreso con icono y color, con un juego inicial en español (un nivel).
- Registro rápido en hoja inferior con teclado numérico propio, últimos valores prefijados y autocompletado por nota.
- Lista de movimientos agrupada por día, con búsqueda y filtros básicos (mes, cuenta, categoría, texto).
- **Recurrentes** (diario, semanal, mensual, anual) que se generan solos al abrir la app.
- Inicio: saldo total, ingresos, gastos y ahorro del mes, previsión a fin de mes.
- Análisis: dónut por categoría y barras de ingresos frente a gastos por mes.
- **Presupuesto mensual simple por categoría** (límite y progreso; sin sobres ni arrastre).
- **Exportar y restaurar copia JSON**, **exportar CSV**, compartir copia con el menú del sistema, recordatorio de copia.
- Tema claro/oscuro automático, modo privacidad, `navigator.storage.persist()`, funcionamiento sin conexión e instalación como PWA.

### Se deja para después (versión 2 o posteriores)

Subcategorías, etiquetas, plantillas o favoritos, objetivos de ahorro, importar CSV de banco, evolución del patrimonio, comparación con periodos anteriores, calendario o mapa de calor, estado punteado, deudas y préstamos, copia cifrada, bloqueo con PIN, accesos directos del icono y empaquetado como APK con Capacitor.

### Se descarta

| Función | Motivo |
|---|---|
| Sincronización bancaria, sincronización entre dispositivos y copias automáticas en la nube | Requieren servidores o servicios externos. |
| IA, OCR, asistente | Servicios externos. |
| Multiusuario, 2FA, OIDC | Sin cuentas de usuario. |
| Partida doble | Demasiado pesada para registrar gastos en el móvil. |
| Presupuesto por sobres | Cambia la filosofía de uso; el presupuesto simple cubre el caso. |
| Inversiones y activos | Fuera del objetivo. |
| Notificaciones push | No son fiables en una PWA sin servidor. |
| Multimoneda y movimientos divididos | **Pendiente de confirmar en la fase 2.** Los propongo fuera porque complican todo el modelo de datos. |
| Adjuntos y ubicación | Poco valor frente al coste de almacenamiento y permisos. |

---

## 4. Propuesta técnica preliminar (librerías)

- **Interfaz: Tailwind CSS + componentes propios sobre Radix UI (enfoque shadcn/ui) + Vaul para las hojas inferiores + iconos Lucide.**
  Los componentes viven en el propio repositorio (MIT): sin estética impuesta, con poco peso y control total sobre el aspecto en el móvil. Radix aporta accesibilidad (foco, lectores de pantalla, teclado) y Vaul la hoja inferior arrastrable que es el corazón del registro rápido. Alternativas descartadas: **MUI** (pesada y con aspecto Material genérico), **Ionic React** (encaja con Capacitor, pero impone su router y su estética, y Capacitor funciona igual con cualquier app web) y **Mantine** (muy completa pero pensada antes para escritorio y más pesada).
- **Gráficos: Recharts.** Componentes React declarativos en SVG, adaptables al tamaño de pantalla, con tema fácil de cambiar entre claro y oscuro, y suficientes para dónut, barras y líneas. Alternativas descartadas: **ECharts** (muy potente pero varias veces más pesada), **Chart.js** (canvas imperativo, peor integración con React y con el tema) y **visx** (demasiado bajo nivel para tres gráficos).
- **Resto:** Dexie.js para IndexedDB detrás de una interfaz de repositorio (para cambiar a SQLite de Capacitor sin tocar pantallas), vite-plugin-pwa para el service worker, Vitest + fake-indexeddb para las pruebas y `Intl.NumberFormat`/`Intl.DateTimeFormat` con `es-ES` para formatos.
