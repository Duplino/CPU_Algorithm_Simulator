/**
 * prioridad-expropiativa.js — Planificación por prioridad, expropiativa.
 *
 * Mismo criterio y misma convención que prioridad.js (menor número = mayor
 * prioridad), pero acá un proceso listo con mayor prioridad que el que está
 * en CPU lo desaloja de inmediato.
 */
function simularPrioridadExpropiativa(procesos, opciones) {
  const comparador = (a, b) => a.prioridad - b.prioridad;

  return SimuladorCore.simularPorInstantes(procesos, {
    comparador,
    expropiativo: true,
    quantum: null,
  });
}
