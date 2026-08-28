/**
 * fifo.js — Planificación FIFO (llamada "FCFS" en otras bibliografías).
 *
 * El primero que entra a la cola de listos es el primero en ejecutar. No hay
 * criterio propio de ordenamiento: el orden queda determinado enteramente
 * por la regla de desempate centralizada en simulador-core.js (procesos
 * desalojados > procesos que vuelven de IO > arribos nuevos, y dentro de
 * cada categoría, por orden real de llegada a la cola).
 */
function simularFIFO(procesos, opciones) {
  return SimuladorCore.simularPorInstantes(procesos, {
    comparador: null,
    expropiativo: false,
    quantum: null,
  });
}
