# Simulador de Planificación de CPU

Herramienta web hecha para la materia **Sistemas Operativos** de la **UTN FRBA**, pensada para practicar la construcción manual de diagramas de Gantt de planificación de CPU y compararlos contra la solución correcta calculada automáticamente.

🔗 **Sitio:** [https://duplino.github.io/CPU_Algorithm_Simulator/](https://duplino.github.io/CPU_Algorithm_Simulator/)

## Qué hace

- Permite cargar procesos (y sus hilos, KLT o ULT) con ráfagas de CPU/IO alternadas.
- Debajo de "Procesos" se pueden agregar hasta 4 dispositivos de E/S (por defecto hay uno solo, llamado "IO"; a partir del segundo se les puede poner nombre, de hasta 3 letras). Con 2 o más, cada ráfaga de E/S elige con cuál se hace — el motor de simulación arma una cola FIFO independiente por dispositivo, así que dos ráfagas en dispositivos distintos se atienden en paralelo de verdad.
- En **"Tu Solución"** el alumno arma a mano, celda por celda, el diagrama de Gantt (un click alterna CPU → cada dispositivo de E/S → nada; dos celdas marcadas con el mismo estado en el mismo instante se resaltan en rojo, sin borrarse solas) y la cola de listos de cada instante.
- En **"Ver algoritmos"** se puede agregar una o más tarjetas, cada una con la solución de referencia de un algoritmo de planificación, y corregir la respuesta propia contra esa solución.

### Algoritmos soportados

- FIFO
- SJF (apropiativo)
- SRTF (SJF expropiativo)
- HRRN
- Prioridad (apropiativa y expropiativa)
- Round Robin
- Round Robin Virtual (con cola de reingreso)

SJF, SRTF y HRRN soportan además un toggle de "estimaciones" (con reestimación por suavizado exponencial) en vez de conocer la ráfaga real de antemano.

### Hilos

Cada proceso tiene uno o más hilos (nombrados "1", "2", ... dentro de cada proceso — ningún hilo tiene trato especial), cada uno con su propia ráfaga y arribo. Un hilo puede ser:

- **KLT**: unidad de planificación independiente, compite por la CPU como si fuera un proceso más.
- **ULT**: comparte con los demás hilos ULT de su mismo proceso una única unidad visible para el sistema operativo, que decide internamente (round robin simple) cuál ejecuta. Cómo se manejan sus llamadas bloqueantes de E/S es configurable por proceso:
  - **Manejada por el SO**: sin manejo especial — la E/S de cualquier hilo ULT bloquea a TODO el grupo hasta que esa E/S puntual termina.
  - **Manejada por la biblioteca** o **Jacketing**: un hilo en E/S no bloquea a sus hermanos (mismo resultado simulado, mecanismos distintos).

### Importar / exportar

Los botones con íconos junto a cada título hacen lo mismo en las dos secciones: descargar como `.json`, cargar desde un archivo `.json` local, o importar desde una URL.

- Junto a **"Procesos"**: las **consignas** (los procesos, sus hilos, y los dispositivos de E/S). Formato `{ "nombre": "...", "procesos": [...], "dispositivosIO": [...] }`, con los procesos en el mismo formato interno de la app (ver los archivos de `ejemplos/` como referencia). Importar consignas reemplaza el ejercicio actual.
- Junto a **"Tu Solución"**: la **solución** que armó el alumno a mano (las celdas CPU/IO de cada carril, más las colas de listos armadas). Formato `{ "nombre": "...", "respuesta": {...}, "colas": [...] }`. Se aplica sobre el ejercicio ya cargado — no trae sus propios procesos, así que solo tiene sentido importarla después de tener las consignas correspondientes cargadas.

### Parámetros de URL

Para compartir un link que abra la app ya armada (ej. desde un campus virtual), se puede pisar el estado inicial con parámetros de query:

- `?procesos=<url>` — importa las consignas desde esa URL al arrancar, en vez del ejercicio de ejemplo.
- `?solucion=<url>` — importa además una solución desde esa URL, aplicada sobre las consignas ya cargadas (las de `?procesos=`, o si no está, las del ejercicio de ejemplo).
- `?algoritmos=fifo,srtf,...` — agrega esas tarjetas en "Ver algoritmos" en vez de la única tarjeta FIFO por defecto (claves separadas por comas: `fifo`, `sjf`, `srtf`, `hrrn`, `prioridad`, `prioridad-expropiativa`, `round-robin`, `round-robin-virtual`).

Ejemplo: `?procesos=https://ejemplo.com/mi-ejercicio.json&solucion=https://ejemplo.com/mi-solucion.json&algoritmos=fifo,srtf`.

### Ejemplos

La carpeta [`ejemplos/`](ejemplos/) tiene ejercicios pensados para importar y comparar dos algoritmos lado a lado (agregando dos tarjetas en "Ver algoritmos"):

- [`round-robin-vs-rrv_quantum-2.json`](ejemplos/round-robin-vs-rrv_quantum-2.json) — Round Robin vs. Round Robin Virtual con quantum 2: muestra cómo el quantum sobrante al volver de una E/S cambia el resultado.
- [`sjf-vs-srtf.json`](ejemplos/sjf-vs-srtf.json) — SJF vs. SRTF: un proceso corto que llega después desaloja al que está corriendo solo en SRTF.
- [`prioridad-vs-prioridad-expropiativa.json`](ejemplos/prioridad-vs-prioridad-expropiativa.json) — mismo caso, pero con prioridades.
- [`hilos-klt-vs-ult-so.json`](ejemplos/hilos-klt-vs-ult-so.json) — un hilo KLT independiente vs. un grupo ULT bloqueado por el SO durante una E/S.

## Uso local

Es una aplicación 100% estática (HTML/CSS/JS vanilla, sin build ni dependencias de servidor), pero necesita servirse por HTTP para que "Importar desde URL" y la lectura de archivos funcionen bien en todos los navegadores — abrir `index.html` directamente como archivo (`file://`) puede fallar para esa parte. Por ejemplo:

```bash
python3 -m http.server 8000
```

y después abrir `http://localhost:8000/`.
