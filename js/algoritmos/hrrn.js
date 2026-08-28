/**
 * hrrn.js — Highest Response Ratio Next.
 *
 * No expropiativo. Entre los procesos listos, elige el que tenga mayor
 * "índice de respuesta":
 *
 *   ratio = (tiempo_de_espera + duración_de_la_ráfaga) / duración_de_la_ráfaga
 *
 * El tiempo de espera se calcula como instante_actual - instante en que el
 * proceso entró a la cola de listos (se recalcula en cada decisión, no se
 * acumula).
 *
 * La "duración de la ráfaga" que entra en la fórmula depende del toggle
 * "Usar estimaciones" (opciones.estimacion):
 *   - Desactivado (por defecto en los otros algoritmos, pero HRRN arranca
 *     con esto ACTIVADO): se usa la ráfaga real que resta, como si la CPU
 *     pudiera predecir el futuro perfectamente.
 *   - Activado: se usa una ESTIMACIÓN por proceso, que arranca en un valor
 *     inicial editable (por defecto, la duración real de la primera ráfaga
 *     de CPU) y se reestima con suavizado exponencial cada vez que termina
 *     una ráfaga real (ver SimuladorCore.reestimarRafaga).
 */
function simularHRRN(procesos, opciones) {
  const estimacionActiva = !!(opciones && opciones.estimacion);
  const alfa = opciones && opciones.alfa != null ? opciones.alfa : 0.5;

  const duracionCriterio = (estadoProceso) =>
    estimacionActiva ? estadoProceso.estimacionRafagaActual : estadoProceso.rafagas[estadoProceso.indiceRafaga].restante;

  const comparador = (a, b, instante) => {
    const duracionA = duracionCriterio(a);
    const duracionB = duracionCriterio(b);
    const ratioA = (instante - a.instanteEntradaAListos + duracionA) / duracionA;
    const ratioB = (instante - b.instanteEntradaAListos + duracionB) / duracionB;
    // Mayor ratio primero => orden ascendente por -ratio.
    return ratioB - ratioA;
  };

  const actualizarEstimacion = estimacionActiva
    ? (estadoProceso, duracionReal) => SimuladorCore.reestimarRafaga(estadoProceso.estimacionRafagaActual, duracionReal, alfa)
    : null;

  // Para que la UI pueda mostrar, al pasar el mouse por la cola de listos,
  // la cuenta completa detrás del ratio (ver ui/grilla-gantt.js y
  // formatearTooltipHRRN en main.js).
  const capturarInfoListos = (estadoProceso, instante) => {
    const espera = instante - estadoProceso.instanteEntradaAListos;
    const duracion = duracionCriterio(estadoProceso);
    const ratio = (espera + duracion) / duracion;
    return { espera, estimacion: duracion, ratio, esEstimada: estimacionActiva };
  };

  return SimuladorCore.simularPorInstantes(procesos, {
    comparador,
    expropiativo: false,
    quantum: null,
    actualizarEstimacion,
    capturarInfoListos,
  });
}
