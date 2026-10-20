# Especificación — Kuenta v1

> Estado: **borrador pendiente de aprobación**. No se empieza la fase 3 hasta que se apruebe.
> Basado en `docs/catalogo-funciones.md` y en las respuestas de la fase 2 (octubre de 2026).

## 0. Resumen de decisiones

| Tema | Decisión |
|---|---|
| Plataforma | PWA instalable, solo archivos estáticos en GitHub Pages; sin servidor, sin cuentas y sin analíticas. |
| Datos | IndexedDB mediante Dexie.js, detrás de una interfaz de repositorio. Se pide `navigator.storage.persist()`. |
| Importes | Céntimos enteros (`number` entero) en todo el dominio. Nunca flotantes para dinero. |
| Moneda y formato | Solo EUR. Interfaz en español; fechas y números en `es-ES`. |
| Tema | **Solo oscuro.** |
| Registro manual | **Hoja inferior rápida** con teclado numérico propio y calculadora (+/−). |
| Bloqueo | **Sin PIN.** |
| Periodo | **Mes natural** (del 1 al último día). |
| Banco | **BBVA, solo cuenta con débito**: un único Excel recoge todos los movimientos. |
| Importación | Excel de BBVA recibido con **"Compartir → Kuenta"** (con botón "Elegir archivo" como alternativa), **conciliado** con lo apuntado a mano. |
| Interfaz | Tailwind CSS + componentes propios sobre Radix UI (enfoque shadcn/ui) + Vaul (hojas inferiores) + iconos Lucide. |
| Gráficos | Recharts. |
| Pruebas | Vitest + fake-indexeddb (lógica y datos); Playwright a 390×844 (interfaz móvil). |

**Nota sobre la importación.** En la fase 2 elegiste solo "Compartir a Kuenta". Compartir lo que entrega es precisamente el Excel de BBVA, así que el lector de ese Excel es imprescindible. El botón "Elegir archivo" usa el mismo código y apenas cuesta nada; lo incluyo para poder importar también desde el ordenador o si Compartir falla.

---

## 1. Alcance de la versión 1

### Funciones incluidas

1. **Cuentas**: efectivo, banco, tarjeta y ahorro, con saldo inicial, saldo calculado, orden y archivado. Una cuenta se marca como "cuenta BBVA" para la importación.
2. **Movimientos**: gasto, ingreso y transferencia entre cuentas propias.
3. **Estado punteado**: lo marca automáticamente la conciliación con el Excel, y también se puede cambiar a mano.
4. **Categorías** con icono y color (un nivel). Se crea un juego inicial en español.
5. **Comercios** (beneficiarios) con categoría sugerida.
6. **Autocompletar**: al escribir el comercio se sugieren la categoría y la cuenta usadas la última vez.
7. **Plantillas o favoritos**: registrar un movimiento habitual con un toque.
8. **Recurrentes** (diario, semanal, mensual o anual, cada N periodos) que se generan solos al abrir la app.
9. **Reglas automáticas** que, al importar, ponen categoría, comercio o nota, o convierten el movimiento en transferencia.
10. **Importación del Excel de BBVA con conciliación**: vista previa, emparejamiento con lo ya apuntado, detección de duplicados, comprobación del saldo y deshacer.
11. **Búsqueda y filtros** en movimientos.
12. **Inicio**: resumen del mes, tasa de ahorro, previsión a fin de mes y avisos.
13. **Gráficos**: dónut de gasto por categoría, barras de ingresos frente a gastos y evolución del patrimonio.
14. **Presupuestos mensuales** por categoría.
15. **Objetivos de ahorro**.
16. **Copias**: exportar y restaurar JSON completo, exportar CSV, compartir la copia con el menú del sistema y recordatorio de copia.
17. **Modo privacidad**: ocultar importes.
18. **Calculadora** en el teclado del importe.
19. PWA: instalable, funciona sin conexión, almacenamiento persistente y destino de "Compartir" para archivos Excel.

---

## 2. Arquitectura

```
src/
  domain/          Lógica pura, sin React ni Dexie (100 % probada con pruebas unitarias)
    money.ts         céntimos: parsear "12,50" → 1250, formatear 1250 → "12,50 €", calculadora
    dates.ts         fechas 'AAAA-MM-DD' sin zonas horarias; meses; sumar días/meses
    balances.ts      saldos por cuenta y fecha, patrimonio
    recurrence.ts    próximas ocurrencias y generación pendiente
    rules.ts         motor de reglas
    reconcile.ts     emparejamiento de filas importadas con movimientos
    budgets.ts       gasto por categoría y mes, límite vigente, ritmo
    stats.ts         resumen del mes, tasa de ahorro, previsión
    csv.ts           exportación CSV
    backup.ts        esquema, validación y migraciones de la copia JSON
  data/
    repository.ts    interfaz DataRepository (la única que ven las pantallas)
    dexie/           implementación con Dexie (IndexedDB)
    seed.ts          categorías iniciales
  import/bbva/     lectura del .xlsx de BBVA → filas normalizadas
  platform/        interfaz PlatformServices (compartir, elegir archivo, persistencia, descarga)
    web.ts           implementación web (Web Share API, <input type=file>, StorageManager)
  ui/              componentes base (botón, hoja, lista, teclado numérico…)
  features/        pantallas por área (inicio, movimientos, análisis, importar, ajustes…)
  sw.ts            service worker propio (precaché + recepción de "Compartir")
```

- **Las pantallas solo hablan con `DataRepository` y `PlatformServices`.** Para empaquetar con Capacitor basta con una implementación SQLite del repositorio (si hiciera falta) y una de `PlatformServices` con los plugins Share y Filesystem; las pantallas no cambian.
- Reactividad: el repositorio emite un evento `change` tras cada escritura. Un hook `useRepoQuery(fn)` vuelve a ejecutar la consulta cuando lo recibe. No se usa `useLiveQuery` de Dexie en las pantallas, para no atarlas a Dexie.
- Las escrituras que tocan varias tablas (importar, restaurar, generar recurrentes, borrar categoría) se hacen en **una única transacción**: o todo o nada.
- Rutas con `HashRouter` (`#/movimientos`), para que GitHub Pages no devuelva 404 al recargar y para que funcione igual dentro de Capacitor.
- Service worker con vite-plugin-pwa en modo `injectManifest`, porque hace falta código propio para recibir archivos compartidos.
- Fuentes del sistema (`system-ui`, Roboto en Android) con cifras tabulares: sin Google Fonts ni otras peticiones externas.
- Identificadores: `crypto.randomUUID()`.
- Validación de datos externos (copia JSON, Excel) con **zod**.

---

## 3. Modelo de datos

Convenciones:

- `Cents` es un entero: `12,34 €` se guarda como `1234`.
- En los movimientos el importe es **siempre positivo**; el signo lo da el tipo.
- Las fechas son cadenas `'AAAA-MM-DD'` (día local, sin hora ni zona) y los meses, `'AAAA-MM'`.
- Las marcas de tiempo técnicas (`createdAt`, `updatedAt`) son ISO 8601.
- `Id` es un UUID en forma de cadena.

```ts
type AccountType = 'cash' | 'bank' | 'card' | 'savings';

interface Account {
  id: Id;
  name: string;              // "BBVA", "Efectivo", "Hucha"
  type: AccountType;
  initialBalance: Cents;     // puede ser negativo
  color: string;             // token de la paleta
  icon: string;              // nombre de icono Lucide
  isBbva: boolean;           // destino por defecto de la importación
  archived: boolean;
  order: number;
  createdAt: string; updatedAt: string;
}

type CategoryKind = 'expense' | 'income';

interface Category {
  id: Id;
  name: string;
  kind: CategoryKind;        // dónde aparece por defecto en el selector
  icon: string; color: string;
  order: number;
  archived: boolean;
}

interface Payee {            // comercio o beneficiario
  id: Id;
  name: string;              // "Mercadona"
  normalized: string;        // "mercadona" (minúsculas, sin tildes), único
  lastCategoryId: Id | null; // para autocompletar
  lastAccountId: Id | null;
  lastUsedAt: string;
}

type TxType = 'expense' | 'income' | 'transfer';
type TxSource = 'manual' | 'template' | 'recurring' | 'import';

interface Transaction {
  id: Id;
  type: TxType;
  amount: Cents;             // > 0
  date: string;              // 'AAAA-MM-DD'
  accountId: Id;             // cuenta origen (o la única cuenta si no es transferencia)
  toAccountId: Id | null;    // solo en transferencias
  categoryId: Id | null;     // null = "Sin categoría"; siempre null en transferencias
  payeeId: Id | null;
  note: string;
  cleared: boolean;          // punteado
  source: TxSource;
  recurringId: Id | null;    // si la generó un recurrente…
  occurrence: string | null; // …qué ocurrencia es (evita duplicados)
  importBatchId: Id | null;  // importación que la creó o la emparejó
  importHash: string | null; // huella de la fila del Excel
  bankConcept: string | null;// texto original de BBVA (Concepto + Movimiento)
  createdAt: string; updatedAt: string;
}

type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

interface Recurring {
  id: Id;
  name: string;
  type: TxType; amount: Cents;
  accountId: Id; toAccountId: Id | null;
  categoryId: Id | null; payeeId: Id | null; note: string;
  frequency: Frequency;
  interval: number;          // cada N (≥ 1)
  startDate: string;         // ancla: fija el día del mes o de la semana
  endDate: string | null;
  nextDate: string | null;   // siguiente ocurrencia pendiente; null = terminado
  active: boolean;
}

interface Template {         // plantilla o favorito
  id: Id;
  name: string;              // "Café"
  type: TxType;
  amount: Cents | null;      // null = pedir el importe al usarla
  accountId: Id | null; toAccountId: Id | null;
  categoryId: Id | null; payeeId: Id | null; note: string;
  order: number;
}

interface Rule {
  id: Id;
  name: string;
  order: number;             // gana la primera regla que coincide
  enabled: boolean;
  match: {
    field: 'bankConcept' | 'payee' | 'note';
    op: 'contains' | 'startsWith' | 'equals';
    value: string;           // comparación sin mayúsculas ni tildes
    direction: 'any' | 'out' | 'in';   // cargo, abono o ambos
  };
  actions: {
    categoryId?: Id;
    payeeName?: string;      // crea o reutiliza el comercio
    note?: string;
    transferAccountId?: Id;  // convierte en transferencia con esta cuenta
  };
}

interface BudgetLimit {      // límite vigente desde un mes en adelante
  id: Id;
  categoryId: Id;
  fromMonth: string;         // 'AAAA-MM'
  amount: Cents;             // 0 = sin presupuesto desde ese mes
}

interface Goal {
  id: Id;
  name: string;
  target: Cents;
  targetDate: string | null;
  accountId: Id | null;      // si está vinculado, progreso = saldo de esa cuenta
  icon: string; color: string;
  archived: boolean;
}

interface GoalEntry {        // aportaciones de objetivos no vinculados a una cuenta
  id: Id; goalId: Id;
  date: string;
  amount: Cents;             // puede ser negativo (retirada)
  note: string;
}

interface ImportBatch {
  id: Id;
  importedAt: string;
  fileName: string;
  accountId: Id;
  dateFrom: string; dateTo: string;
  rows: number; created: number; matched: number; skipped: number;
  bankBalance: Cents | null; // "Disponible" de la fila más reciente
  appBalance: Cents | null;  // saldo de la app a esa fecha, tras importar
  undone: boolean;
}

interface Setting { key: string; value: unknown }
// claves: privacyMode, lastAccountId, lastBackupAt, lastChangeAt,
//         onboardingDone, persistRequested, schemaVersion
```

### Índices de Dexie (versión 1 del esquema)

```
accounts:      id, order
categories:    id, kind, order
payees:        id, &normalized
transactions:  id, date, [accountId+date], [toAccountId+date], categoryId, payeeId,
               &[recurringId+occurrence], importHash, importBatchId
recurring:     id, nextDate
templates:     id, order
rules:         id, order
budgetLimits:  id, [categoryId+fromMonth]
goals:         id
goalEntries:   id, goalId
importBatches: id, importedAt
settings:      key
```

### Reglas de cálculo

- **Saldo de una cuenta a una fecha** = `initialBalance` + ingresos − gastos − transferencias salientes + transferencias entrantes, contando los movimientos con `date ≤ fecha`.
- **Transferencias:** no cuentan como ingreso ni gasto en el resumen, los gráficos, los presupuestos ni la tasa de ahorro. Sí cuentan en los saldos y el patrimonio no cambia.
- **Gasto de una categoría en un mes** = gastos con esa categoría − ingresos con esa categoría. Así, una devolución de Amazon apuntada como ingreso en "Compras" resta del gasto de "Compras".
- **Límite de presupuesto de un mes M** = el `BudgetLimit` de la categoría con el `fromMonth ≤ M` más reciente. Cambiar el límite en octubre no reescribe septiembre.
- **Patrimonio a final de mes** = suma de los saldos de todas las cuentas, archivadas incluidas.

---

## 4. Pantallas

Navegación inferior fija: **Inicio · Movimientos · (+) · Análisis · Más**. El (+) central abre la hoja de registro. Todas las pantallas con periodo usan el mismo selector `‹ octubre 2026 ›`. El icono de ojo para el modo privacidad está en la cabecera de Inicio y de Movimientos.

### 4.1 Primer arranque (asistente)
1. Bienvenida: qué es Kuenta y que los datos solo viven en este móvil.
2. Crear cuentas con su saldo inicial. Se proponen "BBVA" (banco, marcada como cuenta BBVA) y "Efectivo".
3. Se crean las categorías iniciales, se pide almacenamiento persistente y se explica en una frase la importancia de las copias.

### 4.2 Inicio
- Tarjeta del mes: **saldo total**, ingresos, gastos, ahorro (importe y tasa) y "A este ritmo gastarás X € este mes" (solo en el mes actual).
- Avisos, solo si aplican: "Haz una copia de seguridad", "N movimientos sin categoría", "N presupuestos superados", "Han pasado N días desde la última importación de BBVA".
- Plantillas como chips de un toque.
- Cuentas con su saldo (las archivadas no aparecen).
- Próximos recurrentes (14 días).
- Presupuestos: los 3 con mayor porcentaje consumido, con enlace a la pantalla completa.
- Objetivos: barra de progreso de cada uno.

### 4.3 Movimientos
- Buscador por texto (comercio, nota y concepto del banco) y filtros: mes, cuenta, categoría, tipo, "sin categoría" y "no punteado".
- Lista agrupada por día con una cabecera "lunes, 20 oct · −45,30 €" (fecha y neto del día).
- Fila: círculo con el icono y el color de la categoría; comercio o nota; categoría · cuenta en gris; importe a la derecha (ingresos en verde y gastos en color de texto normal); marca ✓ discreta si está punteado.
- Al tocar una fila se abre la hoja de edición.
- Botón "Exportar CSV" que respeta los filtros activos.

### 4.4 Hoja de registro y edición
- Selector **Gasto | Ingreso | Transferencia**.
- **Importe** grande arriba y teclado propio: `1–9`, `0`, `,`, `+`, `−`, `⌫`, `=`. La expresión se ve debajo del resultado ("12,50 + 3,20").
- **Comercio** con autocompletar: elegir uno sugerido rellena la categoría y la cuenta usadas la última vez, siempre que no se hayan cambiado a mano.
- **Categorías**: las 8 más usadas como iconos y "Todas" para ver el resto. Primero aparecen las del tipo elegido.
- **Cuenta** prefijada con la última usada; en transferencias, "De" y "A".
- **Fecha**: chips Hoy · Ayer · Otra (selector).
- **Nota** opcional.
- Solo al editar: interruptor "Punteado", "Duplicar", "Borrar" (con "Deshacer" en un aviso temporal) y, si viene de BBVA, el concepto original.
- "Guardar como plantilla" en el menú de la hoja.
- El botón Guardar indica lo que falta ("Introduce un importe", "Elige la cuenta de destino") hasta que el formulario es válido.

### 4.5 Análisis
Pestañas:
- **Gastos**: dónut del mes por categoría con el total en el centro y debajo la lista de categorías con importe y porcentaje (hace de leyenda). Al tocar una categoría se abre Movimientos filtrado.
- **Mensual**: barras de ingresos frente a gastos de los últimos 6 o 12 meses, con el neto de cada mes.
- **Patrimonio**: línea del patrimonio a final de mes de los últimos 12 meses.

### 4.6 Presupuestos
- Selector de mes. Total presupuestado, gastado y restante.
- Una tarjeta por categoría con presupuesto: gastado / límite, barra de progreso con **marca de "hoy"** (ritmo del mes) y estado *En camino*, *Cerca* (≥ 85 %) o *Superado*.
- Filtro Todos · Superados · En camino.
- Editar el límite "a partir de este mes" y añadir un presupuesto a otra categoría.

### 4.7 Objetivos
- Lista con nombre, importe actual / objetivo, porcentaje y, si tiene fecha, cuánto hay que ahorrar al mes para llegar.
- Detalle: aportaciones (en los objetivos manuales) con "Añadir aportación" y "Retirar".

### 4.8 Importar de BBVA
- **Entrada**: instrucciones breves con los pasos para descargar el Excel en bbva.es y compartirlo con Kuenta, un botón "Elegir archivo" y el historial de importaciones (fecha, periodo, creados, emparejados y "Deshacer").
- **Vista previa** (se abre sola al compartir el archivo), en cuatro grupos plegables:
  - **Nuevos** (se crearán): con la categoría que ha puesto la regla o "Sin categoría", editable en la propia fila; casilla para excluir la fila; acción "Crear regla con este concepto".
  - **Emparejados** (se marcarán como punteados): fila del Excel ↔ movimiento apuntado; se puede deshacer el emparejamiento para crear la fila como nueva.
  - **Dudosos**: varias coincidencias posibles; el usuario elige una o la marca como nueva.
  - **Ya importados** (se ignoran): solo muestra el recuento.
- Botón **Importar**. Pantalla de resultado: "Creados N · Emparejados M · Saldo BBVA 1.234,56 € · Saldo en Kuenta 1.234,56 € ✓ Cuadra", o la diferencia si no cuadra.

### 4.9 Más
Cuentas · Categorías · Comercios · Recurrentes · Plantillas · Reglas · Presupuestos · Objetivos · Importar de BBVA · Copias de seguridad · Ajustes (estado del almacenamiento persistente, espacio usado, versión, licencias de las librerías).

### 4.10 Copias de seguridad
- "Exportar copia" (descarga el JSON) y "Compartir copia" (menú del sistema: Drive, correo, Telegram…).
- "Restaurar copia": elegir el JSON, ver un resumen ("Copia del 12/10/2026: 3 cuentas, 845 movimientos…"), confirmar escribiendo o pulsando "Sustituir todos mis datos", con la opción de exportar antes los datos actuales.
- "Exportar movimientos (CSV)" con el rango de fechas.
- Fecha de la última copia.

### Diseño (solo oscuro)
- Fondo casi negro, tarjetas un tono más claro y bordes sutiles. Un color de acento para las acciones principales. Verde para ingresos, ámbar para *Cerca* y rojo solo para *Superado* y errores.
- Áreas táctiles de al menos 44 px; respeto de `safe-area-inset-*`; cifras tabulares para que los importes se alineen.
- Animaciones cortas (≤ 200 ms) y desactivadas con `prefers-reduced-motion`.

---

## 5. Criterios de aceptación

Todos se comprueban en un viewport de 390×844. Los marcados con 🧪 llevan prueba unitaria.

### 5.1 Importes y formato
- 🧪 "12,5" → 1250; "1.234,56" → 123456; "0,1" + "0,2" → 30 céntimos exactos.
- 🧪 La calculadora evalúa `12,50 + 3,20 − 1` como 1470. No acepta resultados ≤ 0 ni mayores de 9.999.999,99 €; en ese caso muestra un aviso y no deja guardar.
- 🧪 Formato: 123456 → "1.234,56 €" (se agrupan también los millares de 4 cifras); −500 → "−5,00 €".
- 🧪 Las fechas se muestran como "20/10/2026" en tablas y CSV, y "lunes, 20 de octubre" en las cabeceras.
- En modo privacidad todos los importes (incluidos los ejes y las etiquetas de los gráficos) se muestran como "•••• €", y el modo se mantiene al cerrar y abrir la app.

### 5.2 Cuentas y saldos
- 🧪 Una cuenta con saldo inicial de 1.000 €, un gasto de 50 € y un ingreso de 200 € tiene un saldo de 1.150 €.
- 🧪 El saldo a una fecha ignora los movimientos posteriores.
- 🧪 El saldo inicial puede ser negativo.
- No se puede borrar una cuenta con movimientos: se ofrece archivarla. Una cuenta archivada no aparece en los selectores ni en Inicio, pero sus movimientos siguen en el historial y cuentan en el patrimonio.

### 5.3 Transferencias
- 🧪 Una transferencia de 300 € de BBVA a Hucha resta 300 € de BBVA, suma 300 € a Hucha y deja igual el saldo total.
- 🧪 Las transferencias no aparecen en ingresos, gastos, tasa de ahorro, gráficos de categoría ni presupuestos.
- No se puede guardar una transferencia con la misma cuenta de origen y destino.
- 🧪 Editar el importe o las cuentas de una transferencia recalcula correctamente los saldos de las cuentas afectadas.

### 5.4 Registro rápido
- Con la cuenta y la categoría ya recordadas, apuntar un gasto lleva: abrir (+), teclear el importe, tocar una categoría y Guardar.
- Tras guardar aparece "Gasto guardado" con "Deshacer" durante 5 s.
- La hoja no abre el teclado del sistema para el importe.
- La fecha por defecto es la de hoy en hora local; a las 00:30 del día 21, "Hoy" es el 21.

### 5.5 Categorías
- En el primer arranque existen estas categorías:
  - Gasto: Supermercado, Restaurantes, Transporte, Vivienda, Suministros, Salud, Ocio, Compras, Suscripciones, Viajes, Educación, Regalos, Comisiones e impuestos y Otros gastos.
  - Ingreso: Nómina, Reembolsos, Intereses y Otros ingresos.
- Se pueden crear, renombrar y cambiar de icono, color y orden.
- 🧪 Al borrar una categoría usada se pide otra a la que pasar sus movimientos, o "Sin categoría". Sus presupuestos se borran y las reglas que la usaban quedan desactivadas, todo en una sola transacción.

### 5.6 Comercios y autocompletar
- 🧪 Al escribir "merc" se sugiere "Mercadona"; la búsqueda no distingue mayúsculas ni tildes.
- 🧪 Al elegir "Mercadona" se rellenan la última categoría y la última cuenta usadas con ese comercio, salvo que el usuario ya las haya cambiado en esta hoja.
- Un texto nuevo en el campo comercio crea el comercio al guardar. No se crean dos comercios cuyo nombre normalizado coincide.

### 5.7 Plantillas
- Una plantilla con importe crea el movimiento con un toque, con fecha de hoy y un aviso "Deshacer".
- Una plantilla sin importe abre la hoja con todo rellenado salvo el importe.
- Se pueden reordenar y borrar.

### 5.8 Recurrentes
- 🧪 Un mensual con ancla el 31 genera el 31/01, el 28/02 (29/02 en año bisiesto), el 31/03 y el 30/04, sin desplazarse.
- 🧪 Un anual con ancla el 29/02 genera el 28/02 en los años no bisiestos.
- 🧪 "Cada 2 semanas desde el lunes 06/10" genera el 06/10, el 20/10, el 03/11…
- 🧪 Si la app no se abre durante 3 meses, al abrirla se generan de una vez todas las ocurrencias pendientes hasta hoy, y ninguna futura.
- 🧪 Ejecutar la generación dos veces, o en dos pestañas a la vez, no duplica nada (índice único `recurringId + occurrence`).
- 🧪 Respeta `endDate`: no se generan ocurrencias posteriores.
- Los movimientos generados se crean sin puntear, para que la importación de BBVA los empareje.
- Editar un recurrente solo afecta a las ocurrencias futuras; pausarlo detiene la generación.
- La generación se ejecuta al abrir la app y cada vez que vuelve a primer plano.

### 5.9 Reglas
- 🧪 Gana la primera regla activa que coincide, según su orden.
- 🧪 "Concepto contiene *mercadona*" coincide con "COMPRA EN MERCADONA 1234, CON LA TARJETA…".
- 🧪 La dirección *cargo* solo coincide con importes negativos del Excel.
- 🧪 Una regla con `transferAccountId = Efectivo` convierte "RETIRADA EN CAJERO" (−50 €) en una transferencia BBVA → Efectivo de 50 €.
- Desde una fila de la vista previa se puede crear una regla con el concepto ya rellenado; al guardarla, se aplica al resto de filas nuevas de esa vista previa.
- En esta versión las reglas solo se aplican al importar.

### 5.10 Importación de BBVA y conciliación
- 🧪 **Lectura**: localiza la fila de cabecera buscando las columnas *Fecha*, *Concepto* e *Importe* por nombre (sin mayúsculas ni tildes), no por posición. Acepta las fechas como número de serie de Excel o como texto "dd/mm/aaaa", y los importes como número o texto con coma decimal.
- 🧪 Si falta una columna obligatoria, o la divisa no es EUR, muestra un error claro y no importa nada.
- 🧪 **Huella** de cada fila: fecha, importe, concepto, movimiento y disponible. Volver a importar el mismo Excel, o uno con fechas solapadas, crea 0 movimientos: las filas aparecen como "Ya importados".
- 🧪 **Emparejamiento**: una fila se empareja con un movimiento de la cuenta BBVA que tenga el mismo importe y el mismo sentido (cargo = gasto o transferencia saliente; abono = ingreso o transferencia entrante), una fecha a ±3 días, que no esté punteado y que no tenga huella. Si hay varios, se elige el de fecha más cercana; si empatan, la fila va a "Dudosos". Cada movimiento se empareja con una sola fila.
- 🧪 Al confirmar, los emparejados quedan punteados y guardan la huella y el concepto del banco, sin cambiar su categoría ni su nota. Los nuevos se crean punteados, con `source = 'import'`, y les aplica las reglas.
- 🧪 La importación se guarda en una única transacción: si falla, no queda nada a medias.
- 🧪 **Comprobación del saldo**: se compara el *Disponible* de la fila más reciente con el saldo de la cuenta en Kuenta al final de esa fecha y se informa de si cuadra o de la diferencia.
- 🧪 **Deshacer** una importación borra los movimientos que creó y devuelve los emparejados a su estado anterior (sin puntear, sin huella).
- **Compartir**: con la PWA instalada en Android, *Compartir* un `.xlsx` desde Descargas o Archivos muestra Kuenta como destino y abre la vista previa, también sin conexión.
- "Elegir archivo" lleva a la misma vista previa.
- Si las filas son más antiguas que la fecha de creación de la cuenta, se avisa de que el saldo inicial podría quedar mal.

### 5.11 Búsqueda y filtros
- 🧪 La búsqueda encuentra el texto en el comercio, la nota y el concepto del banco, sin distinguir mayúsculas ni tildes.
- Los filtros se combinan entre sí y se muestran como chips que se pueden quitar.
- La lista de un mes con 500 movimientos se desplaza con fluidez en un móvil de gama media.

### 5.12 Inicio y estadísticas
- 🧪 Tasa de ahorro = (ingresos − gastos) / ingresos del mes, sin transferencias; si no hay ingresos se muestra "—".
- 🧪 Previsión a fin de mes = gasto no recurrente hasta hoy / días transcurridos × días del mes + gasto recurrente del mes (el ya generado y el pendiente). Solo se muestra en el mes actual y a partir del día 3.
- El aviso "sin categoría" lleva a Movimientos filtrado.

### 5.13 Gráficos
- 🧪 Las sumas del dónut coinciden con las de la lista de debajo y con el total central, y las devoluciones restan (§3).
- 🧪 Las barras mensuales coinciden con el resumen de cada mes.
- 🧪 El patrimonio de cada mes coincide con la suma de los saldos de las cuentas al último día del mes.
- Los gráficos se adaptan al ancho de la pantalla, se leen sobre fondo oscuro y muestran un estado vacío con texto cuando no hay datos.

### 5.14 Presupuestos
- 🧪 Con un límite de 300 € en "Restaurantes" desde 2026-09 y un cambio a 250 € desde 2026-11, octubre usa 300 € y noviembre y diciembre, 250 €.
- 🧪 La marca de "hoy" está en (día actual / días del mes) del ancho; el estado es *Cerca* desde el 85 % y *Superado* por encima del 100 %.
- 🧪 Los gastos sin categoría no cuentan en ningún presupuesto.

### 5.15 Objetivos
- 🧪 Un objetivo vinculado a la cuenta Hucha muestra como progreso el saldo actual de Hucha.
- 🧪 Un objetivo manual muestra la suma de sus aportaciones; las retiradas restan y no puede quedar por debajo de 0.
- 🧪 Con fecha objetivo: "ahorra X €/mes" = (objetivo − actual) / meses restantes (mínimo 1), redondeado al céntimo hacia arriba.

### 5.16 Copias y CSV
- 🧪 **Ida y vuelta**: exportar, borrar todo y restaurar deja los datos idénticos, tabla por tabla y campo por campo.
- 🧪 Restaurar valida el formato (`app: "kuenta"`, `format`, esquema de cada tabla, referencias entre tablas). Si algo falla, no toca los datos actuales y explica qué está mal.
- 🧪 Una copia de una versión anterior del formato se migra al restaurar; una de una versión más nueva se rechaza con un mensaje.
- 🧪 La restauración sustituye todos los datos en una única transacción.
- 🧪 **CSV**: UTF-8 con BOM, separador `;`, fin de línea CRLF y columnas `Fecha;Tipo;Cuenta;Cuenta destino;Categoría;Comercio;Nota;Importe;Punteado`. Importe con signo y coma decimal (`-12,50`). Se escapan correctamente los textos con `;`, comillas o saltos de línea. Se abre bien en Excel en español con doble clic.
- Nombre de los archivos: `kuenta-copia-AAAA-MM-DD.json` y `kuenta-movimientos-AAAA-MM-DD.csv`.
- "Compartir copia" abre el menú del sistema con el archivo JSON. Si el navegador no puede compartir archivos, se descarga.
- El recordatorio aparece en Inicio cuando han pasado más de 7 días desde la última copia (o nunca se hizo) y ha habido cambios desde entonces. Desaparece al exportar o compartir.

### 5.17 PWA y almacenamiento
- La app se instala desde Chrome en Android con icono y nombre "Kuenta" y se abre a pantalla completa.
- Tras la primera visita funciona sin conexión: abrir, apuntar, ver gráficos, importar y exportar.
- En el primer arranque se llama a `navigator.storage.persist()` y Ajustes muestra si se ha concedido.
- Cuando hay una versión nueva se muestra "Hay una versión nueva · Actualizar" sin recargar a traición.
- 🧪 Las migraciones del esquema de Dexie conservan los datos (prueba con datos de la versión anterior).
- La app no hace ninguna petición a dominios de terceros (se comprueba en la prueba de Playwright).

---

## 6. Fuera de la versión 1

| Función | Motivo o momento |
|---|---|
| Multimoneda | Complica todo el modelo; solo EUR. |
| Movimientos divididos | Complican saldos, presupuestos, CSV e importación. |
| Subcategorías y etiquetas | No elegidas. El modelo admite añadirlas después sin migraciones dolorosas. |
| Pegar texto, CSV genérico de otros bancos, Norma 43, PDF | No elegidos. El lector de BBVA queda aislado en `import/bbva` para añadir otros formatos. |
| Leer notificaciones de BBVA | Requiere la APK de Capacitor. Candidata para cuando exista. |
| Open banking, sincronización, copias automáticas en la nube | Requieren servidores o servicios externos. |
| Bloqueo con PIN, cifrado | No elegido. Se puede añadir más adelante sin tocar el modelo. |
| Tema claro y color de acento personalizable | Solo oscuro. Los colores van en variables CSS, así que añadir un tema claro sería barato. |
| Mes que empieza el día de cobro | Mes natural. |
| Tarjeta de crédito con extracto propio | Solo débito. Se podría añadir como cuenta `card` con su importador. |
| Deudas y préstamos, calendario, mapa de calor, Sankey, informes personalizados, comparación entre periodos | No elegidos o con poco valor en el móvil. |
| Aplicar reglas a movimientos existentes o manuales | En v1 solo se aplican al importar. |
| Accesos directos del icono, widgets, notificaciones | No elegidos o imposibles en una PWA. |
| Varios idiomas, multiusuario, IA, adjuntos, ubicación, inversiones | Fuera del objetivo. |
| Empaquetar como APK | Fase posterior. La arquitectura queda preparada (§2). |

---

## 7. Plan de la fase 3 (pasos)

Cada paso termina con las pruebas en verde, un commit, un resumen y tu visto bueno antes de seguir.

1. **Base y datos**: proyecto Vite + React + TS + Tailwind, ESLint y Vitest; `domain/` (dinero, fechas, saldos, transferencias, recurrentes, copia JSON y CSV) con sus pruebas; `DataRepository` con Dexie y pruebas sobre fake-indexeddb.
2. **Esqueleto de la app**: navegación, tema oscuro, componentes base, PWA (manifest, service worker, persistencia), asistente de primer arranque, Cuentas y Categorías.
3. **Movimientos**: hoja de registro con calculadora, lista con filtros y búsqueda, comercios, autocompletar y plantillas.
4. **Recurrentes**: pantalla y generación al abrir.
5. **Copias**: exportar, compartir y restaurar JSON, exportar CSV y recordatorio.
6. **Importación de BBVA**: lector, reglas, conciliación, vista previa, deshacer y destino de "Compartir".
7. **Presupuestos y objetivos.**
8. **Gráficos e Inicio completo**: análisis por categoría, mensual y patrimonio, y previsión.
9. **Publicación**: GitHub Actions → GitHub Pages, README (ejecutar, instalar en Android, copias de seguridad), prueba de Playwright a 390×844 y pulido.

### Lo que necesito de ti antes del paso 6
Un **Excel real de BBVA anonimizado** (mismas columnas y filas de cabecera, con importes y conceptos inventados o tachados), o capturas de sus primeras filas. Con él escribo las pruebas del lector sobre el formato real, en lugar de sobre el que he deducido investigando.
