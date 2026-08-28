/**
 * prioridad.js — Planificación por prioridad, no expropiativa.
 *
 * Convención de esta cátedra: un número de prioridad MENOR significa MAYOR
 * prioridad (por ejemplo, prioridad 0 se atiende antes que prioridad 5). Si
 * en tu bibliografía es al revés, basta con invertir el signo de la resta
 * en el comparador de abajo.
 *
 * No expropiativo: una vez que un proceso entra a CPU, lo hace hasta que
 * termina su ráfaga, sin importar si llega alguien de mayor prioridad.
 */
function simularPrioridad(procesos, opciones) {
  const comparador = (a, b) => a.prioridad - b.prioridad;

  return SimuladorCore.simularPorInstantes(procesos, {
    comparador,
    expropiativo: false,
    quantum: null,
  });
}
