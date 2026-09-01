# Simulador de Planificación de CPU

Herramienta web hecha para la materia **Sistemas Operativos** de la **UTN FRBA**, pensada para practicar la construcción manual de diagramas de Gantt de planificación de CPU y compararlos contra la solución correcta calculada automáticamente.

🔗 **Sitio:** [https://duplino.github.io/CPU_Algorithm_Simulator/](https://duplino.github.io/CPU_Algorithm_Simulator/)

## Qué hace

- Permite cargar procesos (y sus hilos, KLT o ULT) con ráfagas de CPU/IO alternadas.
- En **"Tu Solución"** el alumno arma a mano, celda por celda, el diagrama de Gantt y la cola de listos de cada instante.
- En **"Ver algoritmos"** se puede agregar una o más tarjetas, cada una con la solución de referencia de un algoritmo de planificación, y corregir la respuesta propia contra esa solución.

### Algoritmos soportados

- FIFO
- SJF (no expropiativo)
- SRTF (SJF expropiativo)
- HRRN
- Prioridad (no expropiativa y expropiativa)
- Round Robin
- Round Robin Virtual (con cola de reingreso)
- Multinivel (100% manual, sin solución de referencia ni corrección automática)

SJF, SRTF y HRRN soportan además un toggle de "estimaciones" (con reestimación por suavizado exponencial) en vez de conocer la ráfaga real de antemano.

### Hilos

Cada proceso tiene uno o más hilos (nombrados "1", "2", ... dentro de cada proceso — ningún hilo tiene trato especial), cada uno con su propia ráfaga y arribo. Un hilo puede ser:

- **KLT**: unidad de planificación independiente, compite por la CPU como si fuera un proceso más.
- **ULT**: comparte con los demás hilos ULT de su mismo proceso una única unidad visible para el sistema operativo, que decide internamente (round robin simple) cuál ejecuta. Cómo se manejan sus llamadas bloqueantes de E/S es configurable por proceso:
  - **Manejada por el SO**: sin manejo especial — la E/S de cualquier hilo ULT bloquea a TODO el grupo hasta que esa E/S puntual termina.
  - **Manejada por la biblioteca** o **Jacketing**: un hilo en E/S no bloquea a sus hermanos (mismo resultado simulado, mecanismos distintos).

### Importar / exportar ejercicios

Un ejercicio (los procesos y sus hilos) se puede:

- **Importar** desde un archivo `.json` local, o desde una URL.
- **Exportar** a un archivo `.json`, para compartirlo o guardarlo.

El formato es `{ "nombre": "...", "procesos": [...] }`, con los procesos en el mismo formato interno de la app (ver los archivos de `ejemplos/` como referencia).

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
