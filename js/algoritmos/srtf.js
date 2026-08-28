/**
 * srtf.js — Shortest Remaining Time First, la versión expropiativa de SJF.
 *
 * Mismo criterio que SJF (menor duración de ráfaga primero), pero acá sí es
 * expropiativo: en cada instante se revisa si algún proceso listo tiene
 * menos tiempo restante que el que está actualmente en CPU, y si es así lo
 * desaloja de inmediato (motivo 'desalojado' en la regla de desempate).
 *
 * Mismo toggle "Usar estimaciones" que SJF y HRRN (opciones.estimacion):
 *   - Desactivado (por defecto): compara por el tiempo REAL que le queda a
 *     la ráfaga actual — la definición clásica de SRTF.
 *   - Activado: en vez del restante real, compara por un "restante
 *     estimado". La reestimación (con suavizado exponencial) solo pasa
 *     cuando una ráfaga TERMINA, así que mientras un proceso se ejecuta (y
 *     es desalojado y retomado varias veces dentro de la misma ráfaga) la
 *     estimación de esa ráfaga se mantiene fija — lo que baja es el tiempo
 *     ya ejecutado, así que el restante estimado se calcula descontando ese
 *     tiempo real ya usado de la estimación:
 *
 *       restante_estimado = estimación_de_la_ráfaga − tiempo_ya_ejecutado_de_esa_ráfaga
 */
function simularSRTF(procesos, opciones) {
  const estimacionActiva = !!(opciones && opciones.estimacion);
  const alfa = opciones && opciones.alfa != null ? opciones.alfa : 0.5;

  const restanteEstimado = (estadoProceso) => {
    const rafagaActual = estadoProceso.rafagas[estadoProceso.indiceRafaga];
    const tiempoEjecutado = rafagaActual.duracion - rafagaActual.restante;
    return Math.max(0, estadoProceso.estimacionRafagaActual - tiempoEjecutado);
  };

  const duracionCriterio = (estadoProceso) =>
    estimacionActiva ? restanteEstimado(estadoProceso) : estadoProceso.rafagas[estadoProceso.indiceRafaga].restante;

  const comparador = (a, b) => duracionCriterio(a) - duracionCriterio(b);

  const actualizarEstimacion = estimacionActiva
    ? (estadoProceso, duracionReal) => SimuladorCore.reestimarRafaga(estadoProceso.estimacionRafagaActual, duracionReal, alfa)
    : null;

  // Misma cuenta para los dos casos en que hace falta mostrarle al alumno
  // "por qué": un proceso ESPERANDO en la cola (capturarInfoListos) y el
  // proceso EJECUTANDO en cada tick (capturarInfoEjecucion) — es literalmente
  // el mismo restante estimado que el motor usa para decidir si desalojar.
  const capturarInfo = (estadoProceso) => {
    const rafagaActual = estadoProceso.rafagas[estadoProceso.indiceRafaga];
    const tiempoEjecutado = rafagaActual.duracion - rafagaActual.restante;
    return {
      estimacion: estadoProceso.estimacionRafagaActual,
      tiempoEjecutado,
      restanteEstimado: Math.max(0, estadoProceso.estimacionRafagaActual - tiempoEjecutado),
    };
  };
  const capturarInfoListos = estimacionActiva ? capturarInfo : null;
  const capturarInfoEjecucion = estimacionActiva ? capturarInfo : null;

  return SimuladorCore.simularPorInstantes(procesos, {
    comparador,
    expropiativo: true,
    quantum: null,
    actualizarEstimacion,
    capturarInfoListos,
    capturarInfoEjecucion,
  });
}
