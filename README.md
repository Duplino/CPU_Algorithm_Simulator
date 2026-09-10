# Simulador de Planificación de CPU

Herramienta web hecha para la materia **Sistemas Operativos** de la **UTN FRBA**, pensada para practicar la construcción manual de diagramas de Gantt de planificación de CPU y compararlos contra la solución correcta calculada automáticamente.

🔗 **Sitio:** [https://duplino.github.io/CPU_Algorithm_Simulator/](https://duplino.github.io/CPU_Algorithm_Simulator/)

🔗 **Tutorial:** [Ver en YouTube](https://youtu.be/Ny5MBA-nFps?si=IRJuvK6twWB6wJMZ)

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
- **ULT**: comparte con los demás hilos ULT de su mismo proceso una única unidad visible para el sistema operativo — el algoritmo elegido en "Ver algoritmos" planifica al proceso entero, no a cada hilo por separado. Cómo se manejan sus llamadas bloqueantes de E/S es configurable por proceso:
  - **Manejada por el SO**: sin manejo especial — la E/S de cualquier hilo ULT bloquea a TODO el grupo hasta que esa E/S puntual termina, y ahí retoma el MISMO hilo que se había ido (la biblioteca no interviene en ese vaivén; solo se la llama para crear o terminar un hilo, con un orden simple).
  - **Manejada por la biblioteca**: mismo bloqueo que "Manejada por el SO" (la llamada también le llega tal cual al SO), pero acá la biblioteca sí decide, con su propio algoritmo (FIFO, SJF, SRTF o Round Robin, cada uno con la ráfaga real — sin estimaciones), a cuál de sus hilos ULT listos le da la CPU cada vez que le toca elegir. Es, para esos hilos, la misma decisión que toma el algoritmo elegido en "Ver algoritmos" para los procesos, un nivel más abajo: el SO ve un único proceso (de ahí el algoritmo "de afuera"), y adentro la biblioteca reparte sus hilos con este otro algoritmo, "de adentro".
  - **Jacketing**: intercepta la llamada de E/S y la vuelve no bloqueante — cuando un hilo pide E/S, el grupo NO se bloquea: sigue corriendo de inmediato con el siguiente hilo que elija la biblioteca (mismo algoritmo configurable que "Manejada por la biblioteca").

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


## Uso local

Es una aplicación 100% estática (HTML/CSS/JS vanilla, sin build ni dependencias de servidor), pero necesita servirse por HTTP para que "Importar desde URL" y la lectura de archivos funcionen bien en todos los navegadores — abrir `index.html` directamente como archivo (`file://`) puede fallar para esa parte. Por ejemplo:

```bash
python3 -m http.server 8000
```

y después abrir `http://localhost:8000/`.
