/**
 * round-robin.js — Round Robin clásico, con quantum configurable.
 *
 * No hay criterio propio de ordenamiento (comparador = null): el orden es
 * el de la cola FIFO de listos, tal como en fifo.js. La diferencia con FIFO
 * es que acá se pasa `quantum`, así que el motor genérico desaloja al
 * proceso en CPU si agota su quantum sin terminar la ráfaga (motivo
 * 'desalojado'), y lo reencola al final de la cola de listos.
 */
function simularRoundRobin(procesos, opciones) {
  const quantum = opciones && opciones.quantum != null ? opciones.quantum : 1;

  return SimuladorCore.simularPorInstantes(procesos, {
    comparador: null,
    expropiativo: false,
    quantum,
  });
}
