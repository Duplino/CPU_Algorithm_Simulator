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

Cada proceso puede tener uno o más hilos, cada uno con su propia ráfaga y arribo. Un hilo puede ser:

- **KLT**: unidad de planificación independiente, compite por la CPU como si fuera un proceso más.
- **ULT**: comparte con los demás hilos ULT de su mismo proceso una única unidad visible para el sistema operativo; la biblioteca ULT (Jacketing o llamadas no bloqueantes) decide internamente cuál ejecuta, sin que uno bloquee a sus hermanos al pedir IO.

## Uso local

Es una aplicación 100% estática (HTML/CSS/JS vanilla, sin build ni dependencias de servidor), pero necesita servirse por HTTP para poder cargar el ejercicio de ejemplo (`data/ejercicios-ejemplo.json`) — abrir `index.html` directamente como archivo (`file://`) no funciona para esa parte. Por ejemplo:

```bash
python3 -m http.server 8000
```

y después abrir `http://localhost:8000/`.
