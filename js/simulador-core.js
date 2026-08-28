/**
 * simulador-core.js
 *
 * Lógica común a todos los algoritmos de planificación:
 *   - la regla de desempate de la cola de listos (ordenarColaListos),
 *   - el modelado del dispositivo de IO (único, con cola FIFO),
 *   - el motor genérico de simulación instante a instante (simularPorInstantes),
 *     que usan FIFO, SJF, SRTF, Prioridad, Prioridad expropiativa, HRRN y Round Robin.
 *
 * Round Robin Virtual NO usa este motor genérico: tiene una estructura de dos
 * colas (normal + reingreso) que se implementa aparte en round-robin-virtual.js,
 * pero sí reutiliza ColaDispositivoIO y los helpers de consolidación/métricas
 * de este archivo.
 *
 * Todo se expone en el objeto global `SimuladorCore` para poder usarse con
 * simples <script> tags, sin necesidad de módulos ES ni build step.
 */
const SimuladorCore = (function () {
  "use strict";

  /**
   * Orden de prioridad para desempatar procesos que están listos en el mismo
   * instante. Esta es la regla específica de la cátedra:
   *
   *   1) "desalojado": procesos que estaban EJECUTANDO y fueron interrumpidos
   *      (por fin de quantum en Round Robin, o por ser desplazados por un
   *      proceso "mejor" en los algoritmos expropiativos como SRTF o
   *      Prioridad expropiativa). Se los trata igual porque en ambos casos el
   *      proceso ya tenía la CPU y la perdió sin terminar su ráfaga.
   *   2) "io": procesos que acaban de completar una ráfaga de IO y vuelven a
   *      pedir CPU.
   *   3) "arribo": procesos que llegan por primera vez en ese instante.
   *
   * Se aplica siempre como criterio secundario, después del criterio propio
   * de cada algoritmo (FIFO por orden de cola, SJF por ráfaga restante, etc.).
   */
  const ORDEN_MOTIVO = { desalojado: 0, io: 1, arribo: 2 };

  /**
   * Ordena una lista de procesos "listos" combinando el criterio propio del
   * algoritmo (comparadorPrincipal) con la regla de desempate de la cátedra.
   *
   * @param {Array} listaProcesos - estados de procesos en estado 'listo'
   * @param {number} instanteActual
   * @param {?Function} comparadorPrincipal - (a, b, instante) => number.
   *        Si es null/undefined, el orden queda determinado solo por el
   *        desempate (motivo de ingreso + orden real de encolado) — esto es
   *        exactamente el comportamiento de FIFO y Round Robin.
   * @returns {Array} copia ordenada (no muta la lista original)
   */
  function ordenarColaListos(listaProcesos, instanteActual, comparadorPrincipal) {
    const copia = listaProcesos.slice();
    copia.sort((a, b) => {
      if (comparadorPrincipal) {
        const resultado = comparadorPrincipal(a, b, instanteActual);
        if (resultado !== 0) return resultado;
      }
      // El desempate por motivo (quantum > IO > arribo) es específicamente
      // para procesos que ingresan a listos EN EL MISMO INSTANTE. Por eso se
      // compara primero el instante de ingreso: alguien que ya esperaba desde
      // antes siempre pasa primero, sin importar su motivo — si esto no se
      // acotara así, un proceso recién desalojado saltaría indefinidamente
      // delante de otros que llevan rato esperando, cada vez que se lo
      // vuelve a desalojar (inanición).
      const cmpEntrada = a.instanteEntradaAListos - b.instanteEntradaAListos;
      if (cmpEntrada !== 0) return cmpEntrada;
      const cmpMotivo = ORDEN_MOTIVO[a.motivoIngreso] - ORDEN_MOTIVO[b.motivoIngreso];
      if (cmpMotivo !== 0) return cmpMotivo;
      // Desempate final: orden real en que entraron a la cola de listos.
      return a.ordenEncolado - b.ordenEncolado;
    });
    return copia;
  }

  /**
   * Modela un único dispositivo de IO compartido por todos los procesos.
   * Si dos procesos piden IO al mismo tiempo, el segundo espera en una cola
   * FIFO hasta que el dispositivo se libera (no hay IO en paralelo).
   */
  class ColaDispositivoIO {
    constructor() {
      this.ocupadoHasta = 0;
    }

    /**
     * Solicita el dispositivo para una ráfaga de IO.
     * @param {number} duracion - duración nominal de la ráfaga de IO
     * @param {number} instanteSolicitud - instante en que el proceso queda libre de CPU y pide IO
     * @returns {{inicio: number, fin: number}} intervalo real en que se usa el dispositivo
     */
    solicitar(duracion, instanteSolicitud) {
      const inicio = Math.max(this.ocupadoHasta, instanteSolicitud);
      const fin = inicio + duracion;
      this.ocupadoHasta = fin;
      return { inicio, fin };
    }
  }

  /**
   * Construye el estado interno inicial de cada proceso a partir de los
   * datos que ingresa el usuario. No muta los procesos originales.
   */
  function crearEstadoInicial(procesos) {
    return procesos.map((p) => ({
      id: p.id,
      arribo: p.arribo,
      prioridad: p.prioridad,
      // Copia profunda de las ráfagas, agregando un contador de "restante"
      // que se va descontando durante la simulación.
      rafagas: p.rafagas.map((r) => ({ tipo: r.tipo, duracion: r.duracion, restante: r.duracion })),
      indiceRafaga: 0,
      estado: "nuevo", // nuevo -> listo -> ejecutando -> io -> listo -> ... -> terminado
      motivoIngreso: null,
      ordenEncolado: null,
      instanteEntradaAListos: null,
      quantumRestante: null,
      instanteFinIO: null,
      primeraEjecucion: null,
      instanteTerminacion: null,
      estimacionRafagaActual:
        p.estimacionInicial != null
          ? p.estimacionInicial
          : (p.rafagas.find((r) => r.tipo === "CPU") || { duracion: 0 }).duracion,
      ticksListo: 0,
    }));
  }

  /**
   * Fusiona eventos de gantt de a un instante (tick) en bloques contiguos
   * del mismo proceso/tipo, para que la grilla no muestre una celda por
   * cada unidad de tiempo cuando en realidad son varias unidades seguidas.
   */
  function consolidarGantt(eventos) {
    const bloques = [];
    eventos.forEach((ev) => {
      const anterior = bloques[bloques.length - 1];
      if (anterior && anterior.proceso === ev.proceso && anterior.tipo === ev.tipo && anterior.fin === ev.inicio) {
        anterior.fin = ev.fin;
      } else {
        bloques.push({ proceso: ev.proceso, inicio: ev.inicio, fin: ev.fin, tipo: ev.tipo });
      }
    });
    return bloques;
  }

  /** Calcula espera/retorno/respuesta a partir de los estados finales de la simulación. */
  function calcularMetricas(estados) {
    const metricas = {};
    estados.forEach((e) => {
      metricas[e.id] = {
        espera: e.ticksListo,
        retorno: e.instanteTerminacion - e.arribo,
        respuesta: e.primeraEjecucion - e.arribo,
      };
    });
    return metricas;
  }

  /**
   * Motor genérico de simulación instante a instante, usado por todos los
   * algoritmos de cola única (FIFO, SJF, SRTF, Prioridad, Prioridad
   * expropiativa, HRRN y Round Robin). Avanza de a 1 unidad de tiempo y en
   * cada paso decide (según el comparador y el flag `expropiativo` que le
   * pasa el algoritmo) quién ocupa la CPU.
   *
   * @param {Array} procesos - procesos originales ingresados por el usuario
   * @param {Object} opciones
   * @param {?Function} opciones.comparador - (a, b, instante) => number, criterio
   *        propio del algoritmo. null/undefined => orden puramente FIFO.
   * @param {boolean} opciones.expropiativo - si true, en cada instante se
   *        reevalúa si el proceso en CPU debe ser desplazado por uno mejor.
   * @param {?number} opciones.quantum - si se define, se aplica Round Robin:
   *        el proceso en CPU es desalojado (motivo 'desalojado') al agotar
   *        el quantum, aunque no haya terminado su ráfaga.
   * @param {?Function} opciones.actualizarEstimacion - (estadoProceso, duracionReal) => nuevaEstimacion.
   *        Sólo lo usa HRRN, para reestimar la próxima ráfaga al terminar la actual.
   * @param {?Function} opciones.capturarInfoListos - (estadoProceso, instante) => objeto.
   *        Opcional: si se pasa, se llama para CADA proceso listo en CADA
   *        instante, y lo que devuelva se guarda en `infoListosPorInstante`
   *        (para que la UI pueda mostrar, ej., un tooltip con la cuenta que
   *        justifica el orden de la cola — hoy lo usan SJF/SRTF/HRRN).
   * @param {?Function} opciones.capturarInfoEjecucion - (estadoProceso, instante) => objeto.
   *        Igual que `capturarInfoListos`, pero se llama para el proceso que
   *        está EJECUTANDO en cada tick (justo después de descontarle la
   *        unidad de tiempo), y se guarda en `infoEjecucionPorInstante`. La
   *        usa SRTF para mostrar, al pasar el mouse por una celda de CPU, el
   *        restante estimado en ESE instante puntual — es lo que el motor
   *        compara contra la cola en cada tick para decidir si desalojarlo.
   * @param {number} [opciones.limiteSeguridad=100000] - tope de instantes para
   *        evitar loops infinitos ante datos inconsistentes.
   */
  function simularPorInstantes(procesos, opciones) {
    const {
      comparador = null,
      expropiativo = false,
      quantum = null,
      actualizarEstimacion = null,
      capturarInfoListos = null,
      capturarInfoEjecucion = null,
    } = opciones;
    const limiteSeguridad = opciones.limiteSeguridad || 100000;

    const estados = crearEstadoInicial(procesos);
    const dispositivoIO = new ColaDispositivoIO();
    const gantt = [];
    const franjasIO = [];
    const colaListosPorInstante = {};
    const infoListosPorInstante = {};
    const infoEjecucionPorInstante = {};

    let contadorEncolado = 0;
    let instante = 0;
    let procesoEjecutando = null;

    const marcarListo = (estado, motivo) => {
      estado.estado = "listo";
      estado.motivoIngreso = motivo;
      estado.ordenEncolado = contadorEncolado++;
      estado.instanteEntradaAListos = instante;
    };

    while (estados.some((e) => e.estado !== "terminado") && instante < limiteSeguridad) {
      // 1) Arribos nuevos en este instante.
      estados.forEach((e) => {
        if (e.estado === "nuevo" && e.arribo === instante) marcarListo(e, "arribo");
      });

      // 2) Selección de quién ejecuta.
      let listos = estados.filter((e) => e.estado === "listo");
      if (procesoEjecutando === null) {
        if (listos.length > 0) {
          const orden = ordenarColaListos(listos, instante, comparador);
          procesoEjecutando = orden[0];
          procesoEjecutando.estado = "ejecutando";
          if (procesoEjecutando.primeraEjecucion === null) procesoEjecutando.primeraEjecucion = instante;
          if (quantum !== null) procesoEjecutando.quantumRestante = quantum;
        }
      } else if (expropiativo && listos.length > 0) {
        const orden = ordenarColaListos(listos, instante, comparador);
        const mejorCandidato = orden[0];
        if (comparador && comparador(mejorCandidato, procesoEjecutando, instante) < 0) {
          // El candidato es estrictamente mejor que el que está en CPU: lo desaloja.
          const desalojado = procesoEjecutando;
          marcarListo(desalojado, "desalojado");
          procesoEjecutando = mejorCandidato;
          procesoEjecutando.estado = "ejecutando";
          if (procesoEjecutando.primeraEjecucion === null) procesoEjecutando.primeraEjecucion = instante;
        }
      }

      // 3) Registrar la cola de listos de este instante para la UI. El
      //    proceso que está ejecutando (o en IO) nunca aparece acá — esto es
      //    específicamente la cola de ESPERA, no "quién está siendo
      //    atendido".
      listos = estados.filter((e) => e.estado === "listo");
      colaListosPorInstante[instante] = ordenarColaListos(listos, instante, comparador).map((e) => e.id);
      if (capturarInfoListos) {
        infoListosPorInstante[instante] = {};
        listos.forEach((e) => {
          infoListosPorInstante[instante][e.id] = capturarInfoListos(e, instante);
        });
      }

      // 4) Ejecutar la unidad de tiempo [instante, instante+1). Las
      //    transiciones que este tick provoca (fin de ráfaga, fin de
      //    quantum) se RESUELVEN más abajo, después de avanzar el reloj,
      //    para que queden fechadas en el instante en que realmente ocurren
      //    (instante+1) y no en el instante en que arrancó el tick — si no,
      //    quedarían "una unidad antes" de tiempo y eso desordena el
      //    desempate con los arribos que sí se miden en el instante real.
      let transicion = null; // 'fin-rafaga' | 'fin-quantum' | null
      let duracionRafagaQueTermino = null;

      if (procesoEjecutando) {
        const e = procesoEjecutando;
        const rafagaActual = e.rafagas[e.indiceRafaga];
        rafagaActual.restante -= 1;
        gantt.push({ proceso: e.id, inicio: instante, fin: instante + 1, tipo: "CPU" });
        if (quantum !== null) e.quantumRestante -= 1;

        // Estado justo después de ejecutar este tick — es lo mismo que se
        // usa en el próximo instante para decidir si hay que desalojarlo,
        // así que tiene sentido mostrárselo al alumno en esta misma celda.
        if (capturarInfoEjecucion) {
          if (!infoEjecucionPorInstante[instante]) infoEjecucionPorInstante[instante] = {};
          infoEjecucionPorInstante[instante][e.id] = capturarInfoEjecucion(e, instante);
        }

        const terminoRafaga = rafagaActual.restante === 0;
        const agotoQuantum = quantum !== null && !terminoRafaga && e.quantumRestante === 0;

        if (terminoRafaga) {
          transicion = "fin-rafaga";
          duracionRafagaQueTermino = rafagaActual.duracion;
        } else if (agotoQuantum) {
          transicion = "fin-quantum";
        }
      } else {
        gantt.push({ proceso: null, inicio: instante, fin: instante + 1, tipo: "IDLE" });
      }

      // 5) Contabilizar tiempo de espera de todos los que quedaron en 'listo' durante este tick.
      estados.forEach((e) => {
        if (e.estado === "listo") e.ticksListo += 1;
      });

      instante += 1;

      // 6) Resolver, ya en el nuevo instante, la transición del proceso que ocupó la CPU.
      if (transicion === "fin-rafaga") {
        const e = procesoEjecutando;
        if (actualizarEstimacion) e.estimacionRafagaActual = actualizarEstimacion(e, duracionRafagaQueTermino);
        e.indiceRafaga += 1;
        if (e.indiceRafaga >= e.rafagas.length) {
          e.estado = "terminado";
          e.instanteTerminacion = instante;
        } else {
          const siguiente = e.rafagas[e.indiceRafaga];
          // Las ráfagas alternan CPU/IO, así que tras una CPU siempre sigue una IO.
          // El proceso se muestra "en IO" recién desde que el dispositivo
          // realmente lo atiende (inicio), no desde que lo solicita: si el
          // dispositivo está ocupado, el tiempo de espera previo no se marca
          // como nada especial (es análogo a esperar en la cola de listos).
          const { inicio, fin } = dispositivoIO.solicitar(siguiente.duracion, instante);
          e.estado = "io";
          e.instanteFinIO = fin;
          franjasIO.push({ proceso: e.id, inicio, fin });
        }
        e.quantumRestante = null;
        procesoEjecutando = null;
      } else if (transicion === "fin-quantum") {
        marcarListo(procesoEjecutando, "desalojado");
        procesoEjecutando.quantumRestante = null;
        procesoEjecutando = null;
      }

      // 7) Los que terminan su IO justo en el nuevo instante vuelven a listos.
      //    Hay que avanzar el índice de ráfaga acá: si no, el proceso queda
      //    apuntando a la ráfaga de IO que recién terminó, y al ejecutar de
      //    nuevo se descontaría por error el contador de ESA ráfaga de IO
      //    en vez del de la próxima ráfaga de CPU.
      estados.forEach((e) => {
        if (e.estado === "io" && e.instanteFinIO === instante) {
          e.indiceRafaga += 1;
          // Caso borde: si la última ráfaga del proceso fuera de IO (poco
          // habitual, pero no imposible), el proceso termina acá en vez de
          // volver a pedir CPU.
          if (e.indiceRafaga >= e.rafagas.length) {
            e.estado = "terminado";
            e.instanteTerminacion = instante;
          } else {
            marcarListo(e, "io");
          }
        }
      });
    }

    return {
      gantt: consolidarGantt(gantt),
      franjasIO,
      colaListosPorInstante,
      infoListosPorInstante,
      infoEjecucionPorInstante,
      metricas: calcularMetricas(estados),
    };
  }

  /**
   * Reestima la duración de la próxima ráfaga de CPU con suavizado
   * exponencial, para los algoritmos que pueden trabajar con estimaciones en
   * vez de conocer la ráfaga real de antemano (SJF, SRTF, HRRN — ver el
   * toggle "Usar estimaciones" en cada uno).
   *
   * OJO con el orden de los pesos, es específico de esta cátedra y al revés
   * de lo más común en otros lados: acá `alfa` pesa la ESTIMACIÓN ANTERIOR
   * (cuánto confiar en la historia) y `(1 - alfa)` pesa la RÁFAGA REAL que
   * acaba de terminar (cuánto confiar en el dato más nuevo) — o sea que un
   * alfa más alto hace que la estimación reaccione MÁS LENTO a cambios.
   *
   *   estimación_siguiente = alfa × estimación_anterior + (1 − alfa) × ráfaga_real_anterior
   */
  function reestimarRafaga(estimacionAnterior, duracionReal, alfa) {
    return alfa * estimacionAnterior + (1 - alfa) * duracionReal;
  }

  return {
    ORDEN_MOTIVO,
    ordenarColaListos,
    ColaDispositivoIO,
    crearEstadoInicial,
    consolidarGantt,
    calcularMetricas,
    simularPorInstantes,
    reestimarRafaga,
  };
})();
