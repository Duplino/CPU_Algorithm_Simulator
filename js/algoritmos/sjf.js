/**
 * sjf.js — Shortest Job First, no expropiativo.
 *
 * Entre los procesos listos, elige siempre el que tiene menor duración de
 * ráfaga de CPU. Como no es expropiativo, esta elección solo se reevalúa
 * cuando la CPU queda libre (fin de ráfaga), nunca interrumpe a un proceso
 * que ya está ejecutando.
 *
 * Como SJF necesita saber de antemano cuánto dura la ráfaga, tiene el
 * toggle "Usar estimaciones" (opciones.estimacion):
 *   - Desactivado (por defecto): usa la ráfaga real, como si la CPU pudiera
 *     predecir el futuro perfectamente — es la definición clásica de SJF.
 *   - Activado: usa una ESTIMACIÓN por proceso en vez de la ráfaga real,
 *     igual que HRRN (estimación inicial editable + reestimación con
 *     suavizado exponencial al terminar cada ráfaga real — ver
 *     SimuladorCore.reestimarRafaga).
 */
function simularSJF(procesos, opciones) {
  const estimacionActiva = !!(opciones && opciones.estimacion);
  const alfa = opciones && opciones.alfa != null ? opciones.alfa : 0.5;

  const duracionCriterio = (estadoProceso) =>
    estimacionActiva ? estadoProceso.estimacionRafagaActual : estadoProceso.rafagas[estadoProceso.indiceRafaga].restante;

  const comparador = (a, b) => duracionCriterio(a) - duracionCriterio(b);

  const actualizarEstimacion = estimacionActiva
    ? (estadoProceso, duracionReal) => SimuladorCore.reestimarRafaga(estadoProceso.estimacionRafagaActual, duracionReal, alfa)
    : null;

  // Solo tiene sentido mostrar un tooltip con la estimación cuando el
  // criterio realmente ES una estimación (si no, es la ráfaga real y no hay
  // nada que explicar).
  const capturarInfoListos = estimacionActiva ? (estadoProceso) => ({ estimacion: estadoProceso.estimacionRafagaActual }) : null;

  return SimuladorCore.simularPorInstantes(procesos, {
    comparador,
    expropiativo: false,
    quantum: null,
    actualizarEstimacion,
    capturarInfoListos,
  });
}
