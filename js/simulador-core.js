/**
 * simulador-core.js
 *
 * Lógica común a todos los algoritmos de planificación:
 *   - la regla de desempate de la cola de listos (ordenarColaListos),
 *   - el modelado de los dispositivos de E/S (uno o varios, cada uno con su
 *     propia cola FIFO — ver ColaDispositivosIO),
 *   - el motor genérico de simulación instante a instante (simularPorInstantes),
 *     que usan FIFO, SJF, SRTF, Prioridad, Prioridad expropiativa, HRRN y Round Robin.
 *
 * Round Robin Virtual NO usa este motor genérico: tiene una estructura de dos
 * colas (normal + reingreso) que se implementa aparte en round-robin-virtual.js,
 * pero sí reutiliza ColaDispositivosIO y los helpers de consolidación/métricas
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
   * Modela el conjunto de dispositivos de E/S del ejercicio (por defecto uno
   * solo, "IO"; puede haber hasta 4 — ver EditorProcesos.renderizarDispositivosIO
   * y la columna de E/S en la tabla de "Procesos", que ahora deja elegir CON
   * QUÉ dispositivo se hace cada ráfaga). Cada dispositivo tiene su PROPIA
   * cola FIFO independiente: dos ráfagas en el MISMO dispositivo se turnan
   * (la segunda espera a que la primera termine), pero dos ráfagas en
   * dispositivos DISTINTOS se atienden en paralelo, sin bloquearse entre sí.
   * Las colas se crean solas, la primera vez que se pide cada nombre — no
   * hace falta declarar de antemano cuáles existen.
   */
  class ColaDispositivosIO {
    constructor() {
      this.ocupadoHastaPorDispositivo = {};
    }

    /**
     * Solicita EL dispositivo `nombreDispositivo` para una ráfaga de IO.
     * @param {string} nombreDispositivo - viene de `rafaga.dispositivoIO`;
     *        si una ráfaga vieja no lo trae (ejercicios de antes de que
     *        existiera esta opción), el llamador pasa "IO" por default.
     * @param {number} duracion - duración nominal de la ráfaga de IO
     * @param {number} instanteSolicitud - instante en que el proceso queda libre de CPU y pide IO
     * @returns {{inicio: number, fin: number}} intervalo real en que se usa el dispositivo
     */
    solicitar(nombreDispositivo, duracion, instanteSolicitud) {
      const ocupadoHasta = this.ocupadoHastaPorDispositivo[nombreDispositivo] || 0;
      const inicio = Math.max(ocupadoHasta, instanteSolicitud);
      const fin = inicio + duracion;
      this.ocupadoHastaPorDispositivo[nombreDispositivo] = fin;
      return { inicio, fin };
    }
  }

  /**
   * A partir de los procesos que cargó el usuario, arma la lista de
   * UNIDADES PLANIFICABLES que realmente compiten por la CPU — no siempre
   * es "una por hilo": depende de cómo esté configurado cada uno (ver
   * editor-procesos.js y la fila "Biblioteca ULT"). Ningún hilo tiene
   * trato especial (no existe un "hilo principal" para el motor): TODOS
   * los hilos de `proceso.hilos[]` se recorren de la misma manera.
   *
   *   - Un hilo KLT es una unidad independiente: el SO lo ve y lo
   *     planifica exactamente como si fuera un proceso más — con SU
   *     PROPIO arribo, que puede ser distinto al de otros hilos del mismo
   *     proceso (ej. un hilo que se crea recién cuando el proceso ya lleva
   *     un rato corriendo).
   *   - Los hilos ULT de UN MISMO proceso comparten una única unidad
   *     COMPUESTA: el SO solo ve y planifica al proceso como un todo. Cómo
   *     se comporta puertas adentro depende de la biblioteca ULT del
   *     proceso (ver `bloqueaGrupo` y `planificacionInterna`):
   *       - "so": la biblioteca solo se llama para crear o terminar un
   *         hilo (elige con orden simple); una E/S bloqueante de CUALQUIER
   *         hilo bloquea a TODO el grupo (llega tal cual al SO, que no
   *         distingue hilos) hasta que esa E/S puntual termina, y ahí
   *         retoma el MISMO hilo que se había ido — la biblioteca ni se
   *         entera de ese vaivén.
   *       - "biblioteca": mismo bloqueo que "so" (la llamada también llega
   *         tal cual al SO), pero la biblioteca reparte la CPU entre sus
   *         hilos ULT listos con el algoritmo que se le configuró (FIFO,
   *         SJF, SRTF o Round Robin — ver planificacionInterna).
   *       - "jacketing": intercepta la llamada y la vuelve NO bloqueante —
   *         cuando un hilo pide E/S, el grupo sigue corriendo de inmediato
   *         con el siguiente hilo que elija la biblioteca (mismo algoritmo
   *         configurable que "biblioteca").
   *     Como cada miembro también puede tener su propio arribo, la unidad
   *     compuesta "arriba" por primera vez con el MÁS TEMPRANO de sus
   *     miembros — el resto se suma al grupo más tarde, en su propio
   *     instante (ver resolverArriboDeCompuesta).
   *
   * El `id` de cada unidad simple es el mismo que usa el Gantt para esa
   * fila (`proceso.id + "." + hilo.id` — ver ui/grilla-gantt.js/
   * construirCarriles), así que el resto del motor no necesita saber nada
   * de hilos: solo mete los eventos de CPU/IO en el `id` que corresponda.
   * Una unidad COMPUESTA no tiene fila propia en el Gantt (no representa a
   * un hilo puntual): usa `proceso.id + ".ult"`.
   */
  function construirUnidadesPlanificables(procesos) {
    const unidades = [];
    procesos.forEach((proceso) => {
      const miembrosULT = [];

      proceso.hilos.forEach((hilo) => {
        const idHilo = `${proceso.id}.${hilo.id}`;
        if (hilo.tipo === "ULT") {
          miembrosULT.push({ id: idHilo, arribo: hilo.arribo, rafagas: hilo.rafagas });
        } else {
          unidades.push({
            id: idHilo,
            arribo: hilo.arribo,
            proceso,
            rafagas: hilo.rafagas,
            miembros: null,
          });
        }
      });

      if (miembrosULT.length > 0) {
        unidades.push({
          id: `${proceso.id}.ult`,
          // La unidad compuesta "arriba" con el más temprano de sus
          // miembros — los demás se suman al grupo más tarde (ver
          // resolverArriboDeCompuesta).
          arribo: Math.min(...miembrosULT.map((m) => m.arribo)),
          proceso,
          rafagas: null,
          miembros: miembrosULT,
        });
      }
    });
    return unidades;
  }

  function copiarRafagasConRestante(rafagas) {
    return rafagas.map((r) => ({ tipo: r.tipo, duracion: r.duracion, restante: r.duracion, dispositivoIO: r.dispositivoIO }));
  }

  /** El nombre del dispositivo de E/S que usa `rafaga` — "IO" (el default de siempre) si no trae uno explícito (ejercicios de antes de que existiera esta opción). */
  function nombreDispositivoDe(rafaga) {
    return rafaga.dispositivoIO || "IO";
  }

  /** Misma lógica de "estimación inicial efectiva" que EditorProcesos.estimacionEfectiva, pero acá no se puede importar ese módulo (orden de carga de <script>), así que se repite. */
  function estimacionInicialPara(proceso, rafagasDeReferencia) {
    if (proceso.estimacionInicial != null) return proceso.estimacionInicial;
    const primeraCPU = rafagasDeReferencia.find((r) => r.tipo === "CPU");
    return primeraCPU ? primeraCPU.duracion : 0;
  }

  /**
   * Construye el estado interno inicial de cada UNIDAD planificable (ver
   * construirUnidadesPlanificables) a partir de los procesos que ingresó
   * el usuario. No muta los procesos originales.
   *
   * Una unidad COMPUESTA (grupo de hilos ULT) guarda el progreso de CADA
   * miembro por separado (`miembros`), pero además expone `rafagas` /
   * `indiceRafaga` "espejados" desde el miembro activo (`miembroActivoId`)
   * — son la MISMA referencia (no una copia), así que el resto del motor
   * (que no sabe nada de hilos: solo descuenta `rafagas[indiceRafaga].restante`)
   * puede tratar a esta unidad exactamente como a una simple. Cuando el
   * miembro activo cambia (ver resolverFinRafagaCompuesta), esos dos campos
   * se reapuntan al nuevo miembro.
   */
  function crearEstadoInicial(procesos) {
    const unidades = construirUnidadesPlanificables(procesos);
    return unidades.map((u) => {
      const base = {
        id: u.id,
        arribo: u.arribo,
        prioridad: u.proceso.prioridad,
        estado: "nuevo", // nuevo -> listo -> ejecutando -> io|esperando-miembros -> listo -> ... -> terminado
        motivoIngreso: null,
        ordenEncolado: null,
        instanteEntradaAListos: null,
        quantumRestante: null,
        instanteFinIO: null,
        primeraEjecucion: null,
        instanteTerminacion: null,
        ticksListo: 0,
        // Solo lo usa Round Robin Virtual: si al irse a IO justo se le
        // había agotado el quantum en ese mismo tick, al volver reingresa
        // por la cola NORMAL en vez de la prioritaria (ver
        // round-robin-virtual.js) — para el resto de los algoritmos queda
        // siempre en false, sin efecto.
        agotoQuantumAlIrseAIO: false,
      };

      if (!u.miembros) {
        const rafagas = copiarRafagasConRestante(u.rafagas);
        return {
          ...base,
          esCompuesta: false,
          rafagas,
          indiceRafaga: 0,
          estimacionRafagaActual: estimacionInicialPara(u.proceso, rafagas),
        };
      }

      // Todos los miembros arrancan "no-llegado": ninguno se activa acá
      // directamente (ni siquiera el que arriba en el instante 0) — eso lo
      // resuelve resolverArribosDeMiembros en su primer tick, exactamente
      // igual que una unidad simple no queda "lista" hasta que el motor
      // procesa su arribo (ver el paso 1 de simularPorInstantes).
      const miembros = u.miembros.map((m) => ({
        id: m.id,
        arribo: m.arribo,
        rafagas: copiarRafagasConRestante(m.rafagas),
        indiceRafaga: 0,
        estado: "no-llegado", // no-llegado | listo | io | terminado
        instanteFinIO: null,
        // Para el desempate FIFO entre miembros LISTOS (ver
        // compararOrdenLlegadaMiembro) — análogos a instanteEntradaAListos/
        // ordenEncolado de una unidad, pero internos a esta biblioteca.
        instanteEntradaAListos: null,
        ordenEncoladoInterno: null,
      }));
      // Placeholder inicial e inerte: nada lo lee hasta que la unidad
      // compuesta deja de estar "nuevo" (resolverArribosDeMiembros
      // reasigna el miembro activo de verdad en ese momento).
      const activo = miembros[0];
      return {
        ...base,
        esCompuesta: true,
        // "so" y "biblioteca": la llamada bloqueante de E/S llega tal cual
        // al SO, que no distingue hilos — así que la E/S de CUALQUIER
        // miembro bloquea a todo el grupo hasta que esa E/S puntual
        // termina (ver resolverFinRafagaCompuesta/resolverRetornosDeIOCompuestos).
        // "jacketing" intercepta la llamada y la vuelve no bloqueante: un
        // hilo que pide E/S no se lleva puesto al resto — el grupo sigue
        // corriendo con el siguiente hilo que decida la biblioteca (ver
        // planificacionInterna, más abajo — resolverFinRafagaCompuesta cae
        // directo a elegirMejorMiembroListo cuando bloqueaGrupo es false,
        // sin pasar por el SO).
        bloqueaGrupo: u.proceso.algoritmoBiblioteca === "so" || u.proceso.algoritmoBiblioteca === "biblioteca",
        miembroBloqueanteId: null,
        // Con qué criterio la biblioteca reparte la CPU ENTRE sus hilos
        // ULT listos — configurable con "Manejada por la biblioteca" Y con
        // "Jacketing" (ambas consultan a la biblioteca; solo difieren en
        // si una E/S bloquea al grupo o no — ver bloqueaGrupo arriba). Con
        // "so" no hay nada que configurar: la biblioteca solo se llama para
        // crear y terminar hilos, con un orden simple (planificacionInterna
        // = null, ver elegirMejorMiembroListo) — y cuando un hilo vuelve de
        // una E/S, retoma él mismo directo, sin pasar por la biblioteca en
        // absoluto (ver miembroBloqueanteQueVolvio en resolverRetornosDeIOCompuestos).
        planificacionInterna:
          u.proceso.algoritmoBiblioteca === "biblioteca" || u.proceso.algoritmoBiblioteca === "jacketing"
            ? u.proceso.planificacionBiblioteca || { algoritmo: "fifo", quantum: 2 }
            : null,
        quantumInternoRestante: null,
        contadorEncoladoInterno: 0,
        miembros,
        miembroActivoId: activo.id,
        rafagas: activo.rafagas,
        indiceRafaga: activo.indiceRafaga,
        estimacionRafagaActual: estimacionInicialPara(u.proceso, activo.rafagas),
      };
    });
  }

  /** El id que realmente hay que anotar en el Gantt/franjas de IO: el de la unidad misma, o el del miembro activo si es una unidad compuesta. */
  function idEjecutable(estadoUnidad) {
    return estadoUnidad.esCompuesta ? estadoUnidad.miembroActivoId : estadoUnidad.id;
  }

  /**
   * Dentro de una unidad compuesta (grupo de hilos ULT), elige el próximo
   * miembro LISTO por round robin simple — o null si ninguno lo está. Es
   * el criterio de repuesto para "so" (que no tiene un algoritmo interno
   * elegible: la biblioteca solo se llama para crear o terminar un hilo,
   * sin más criterio — ver elegirMejorMiembroListo), y por eso mismo uno
   * simple alcanza. Si el que ya estaba marcado como activo sigue listo
   * (ej. varios miembros arriban juntos y ESE ya lo estaba), se queda con
   * él; si no, avanza cíclicamente desde su posición.
   */
  function elegirSiguienteMiembroListoRoundRobinSimple(estadoCompuesto) {
    const miembros = estadoCompuesto.miembros;
    const indiceActual = miembros.findIndex((m) => m.id === estadoCompuesto.miembroActivoId);
    if (indiceActual >= 0 && miembros[indiceActual].estado === "listo") return miembros[indiceActual];
    for (let paso = 1; paso <= miembros.length; paso++) {
      const candidato = miembros[(indiceActual + paso) % miembros.length];
      if (candidato.estado === "listo") return candidato;
    }
    return null;
  }

  /** Cuánto le queda a un miembro de su ráfaga de CPU actual. */
  function restanteMiembro(miembro) {
    return miembro.rafagas[miembro.indiceRafaga].restante;
  }

  /**
   * Desempate por orden de llegada ENTRE MIEMBROS de una misma unidad
   * compuesta — lo usan FIFO y Round Robin (ver elegirMejorMiembroListo)
   * como criterio principal, y SJF/SRTF como desempate cuando dos miembros
   * tienen el mismo restante. Análogo a instanteEntradaAListos/ordenEncolado
   * de una unidad, pero interno a esta biblioteca (ver marcarMiembroListoInterno).
   */
  function compararOrdenLlegadaMiembro(a, b) {
    const diff = (a.instanteEntradaAListos || 0) - (b.instanteEntradaAListos || 0);
    if (diff !== 0) return diff;
    return (a.ordenEncoladoInterno || 0) - (b.ordenEncoladoInterno || 0);
  }

  /**
   * Marca un miembro como "listo" DENTRO de la biblioteca — análogo a
   * marcarListo de una unidad (motor externo), pero llevando la cuenta
   * interna (instanteEntradaAListos/ordenEncoladoInterno) que usan FIFO,
   * SJF, SRTF y Round Robin como desempate entre miembros. Se llama en los
   * 4 momentos en que un miembro puede pasar a estar listo: arribo, retorno
   * de una E/S, y — para los algoritmos internos expropiativos/con quantum
   * — al ser desalojado por otro miembro (ver
   * resolverPreempcionInternaCompuesta / resolverQuantumInternoCompuesta).
   */
  function marcarMiembroListoInterno(estadoCompuesto, miembro, instante) {
    miembro.instanteEntradaAListos = instante;
    miembro.ordenEncoladoInterno = estadoCompuesto.contadorEncoladoInterno++;
  }

  /**
   * Elige, de entre los miembros LISTOS de una unidad compuesta, cuál
   * corresponde activar según el algoritmo interno de su biblioteca (ver
   * editor-procesos.js/crearSelectorPlanificacionBiblioteca) — es la MISMA
   * decisión que toma el algoritmo elegido en "Ver algoritmos" para los
   * procesos, un nivel más abajo: el SO ve un único proceso (por eso hay un
   * algoritmo "de afuera"), y adentro la biblioteca reparte sus hilos ULT
   * con este otro algoritmo, "de adentro".
   *
   *   - "fifo" / "round-robin": el que espera hace más tiempo (Round Robin
   *     no tiene un criterio de ORDEN propio — la diferencia con FIFO es
   *     que además fuerza cambios por quantum interno, ver
   *     resolverQuantumInternoCompuesta).
   *   - "sjf" / "srtf": el de menor ráfaga (restante) real.
   *
   * Sin planificación interna configurada (biblioteca "so", que no tiene
   * este nivel de detalle), cae al round robin simple de siempre.
   */
  function elegirMejorMiembroListo(estadoCompuesto) {
    const planificacion = estadoCompuesto.planificacionInterna;
    if (!planificacion) return elegirSiguienteMiembroListoRoundRobinSimple(estadoCompuesto);

    const candidatos = estadoCompuesto.miembros.filter((m) => m.estado === "listo");
    if (candidatos.length === 0) return null;

    if (planificacion.algoritmo === "sjf" || planificacion.algoritmo === "srtf") {
      candidatos.sort((a, b) => restanteMiembro(a) - restanteMiembro(b) || compararOrdenLlegadaMiembro(a, b));
    } else {
      candidatos.sort(compararOrdenLlegadaMiembro);
    }
    return candidatos[0];
  }

  function activarMiembro(estadoCompuesto, miembro) {
    estadoCompuesto.miembroActivoId = miembro.id;
    estadoCompuesto.rafagas = miembro.rafagas;
    estadoCompuesto.indiceRafaga = miembro.indiceRafaga;
    // Cada vez que arranca a correr un miembro (sea porque otro terminó,
    // volvió de una E/S, arribó, o lo desalojó otro) empieza con el
    // quantum INTERNO fresco — solo importa si la biblioteca usa Round
    // Robin (ver resolverQuantumInternoCompuesta), que lo reinicializa solo
    // cuando lo encuentra en null.
    estadoCompuesto.quantumInternoRestante = null;
  }

  /**
   * Solo para biblioteca "srtf": si en ESTE tick hay un miembro listo (que
   * no sea el activo) con MENOS restante que el activo, lo desaloja de
   * inmediato — invisible para el SO (no toca `procesoEjecutando` ni el
   * quantum externo, ver simularPorInstantes/round-robin-virtual.js, que
   * llaman a esto ANTES de descontarle la unidad de tiempo al activo, para
   * decidir a quién le toca ESTE tick). El miembro desalojado vuelve a
   * quedar "listo" (se reencola con instanteEntradaAListos actualizado,
   * como cualquier otro reingreso interno).
   */
  function resolverPreempcionInternaCompuesta(estadoCompuesto, instante) {
    const planificacion = estadoCompuesto.planificacionInterna;
    if (!planificacion || planificacion.algoritmo !== "srtf") return;

    const activo = estadoCompuesto.miembros.find((m) => m.id === estadoCompuesto.miembroActivoId);
    const otrosListos = estadoCompuesto.miembros.filter((m) => m.estado === "listo" && m.id !== activo.id);
    if (otrosListos.length === 0) return;

    otrosListos.sort((a, b) => restanteMiembro(a) - restanteMiembro(b) || compararOrdenLlegadaMiembro(a, b));
    const mejor = otrosListos[0];
    if (restanteMiembro(mejor) < restanteMiembro(activo)) {
      marcarMiembroListoInterno(estadoCompuesto, activo, instante);
      activarMiembro(estadoCompuesto, mejor);
    }
  }

  /**
   * Solo para biblioteca "round-robin": descuenta el quantum INTERNO del
   * miembro activo por este tick y, si se agota Y su ráfaga NO terminó
   * también en este mismo tick (eso ya lo resuelve, por su cuenta,
   * resolverFinRafagaCompuesta), lo desaloja y activa al siguiente miembro
   * listo en orden de llegada — invisible para el SO, igual que la
   * expropiación de SRTF. Si no queda nadie más listo, sigue el mismo con
   * un quantum interno fresco (no tiene sentido "desalojarlo" para
   * dárselo de nuevo a él mismo).
   *
   * Se llama DESPUÉS de descontarle la unidad de tiempo al activo (para
   * saber si esta ráfaga terminó justo ahora), en el mismo punto donde el
   * motor que llama resuelve sus propias transiciones.
   */
  function resolverQuantumInternoCompuesta(estadoCompuesto, terminoRafagaEsteTick, instante) {
    const planificacion = estadoCompuesto.planificacionInterna;
    if (!planificacion || planificacion.algoritmo !== "round-robin") return;
    if (terminoRafagaEsteTick) return;

    if (estadoCompuesto.quantumInternoRestante == null) estadoCompuesto.quantumInternoRestante = planificacion.quantum;
    estadoCompuesto.quantumInternoRestante -= 1;
    if (estadoCompuesto.quantumInternoRestante > 0) return;

    const activo = estadoCompuesto.miembros.find((m) => m.id === estadoCompuesto.miembroActivoId);
    const otrosListos = estadoCompuesto.miembros.filter((m) => m.estado === "listo" && m.id !== activo.id);
    if (otrosListos.length === 0) {
      // Nadie más para darle el turno: sigue el mismo, con quantum fresco.
      estadoCompuesto.quantumInternoRestante = planificacion.quantum;
      return;
    }

    otrosListos.sort(compararOrdenLlegadaMiembro);
    marcarMiembroListoInterno(estadoCompuesto, activo, instante);
    activarMiembro(estadoCompuesto, otrosListos[0]);
  }

  /**
   * Resuelve el fin de la ráfaga de CPU del miembro ACTIVO de una unidad
   * compuesta (grupo ULT) — análogo a la resolución de "fin-rafaga" de una
   * unidad simple, pero además decide, antes de devolverle el control al
   * planificador externo, si otro hilo ULT del mismo proceso puede seguir
   * usando la CPU de inmediato. Ese cambio interno es INVISIBLE para el
   * SO: no cuenta como un nuevo ingreso a listos ni resetea el quantum —
   * de eso se ocupa quien llama a esta función, no ella (ver
   * simularPorInstantes y round-robin-virtual.js, que manejan el quantum
   * de manera distinta entre sí).
   *
   * @returns {"sigue"|"vacia"|"terminada"} — "sigue": la unidad compuesta
   *          sigue ejecutando (otro miembro tomó la posta). "vacia":
   *          ningún miembro está listo ahora mismo (puede volver a estarlo
   *          más adelante, cuando alguno vuelva de IO). "terminada": todos
   *          los miembros terminaron.
   */
  function resolverFinRafagaCompuesta(estadoCompuesto, dispositivoIO, instante, franjasIO, actualizarEstimacion, duracionRafagaQueTermino) {
    const miembro = estadoCompuesto.miembros.find((m) => m.id === estadoCompuesto.miembroActivoId);
    if (actualizarEstimacion) {
      estadoCompuesto.estimacionRafagaActual = actualizarEstimacion(estadoCompuesto, duracionRafagaQueTermino);
    }
    miembro.indiceRafaga = estadoCompuesto.indiceRafaga + 1;

    if (miembro.indiceRafaga >= miembro.rafagas.length) {
      miembro.estado = "terminado";
    } else {
      const siguiente = miembro.rafagas[miembro.indiceRafaga];
      const nombreDispositivo = nombreDispositivoDe(siguiente);
      const { inicio, fin } = dispositivoIO.solicitar(nombreDispositivo, siguiente.duracion, instante);
      miembro.estado = "io";
      miembro.instanteFinIO = fin;
      franjasIO.push({ proceso: miembro.id, inicio, fin, dispositivo: nombreDispositivo });

      // Biblioteca "manejada por el SO" o "por la biblioteca" (bloqueaGrupo):
      // esta E/S puntual bloquea a TODO el grupo, sin importar si algún
      // otro miembro está listo — el SO no sabe que hay más hilos, así que
      // no le da la CPU al proceso hasta que ESTA E/S puntual termine (ver
      // resolverRetornosDeIOCompuestos, que respeta `miembroBloqueanteId`).
      if (estadoCompuesto.bloqueaGrupo) {
        estadoCompuesto.miembroBloqueanteId = miembro.id;
        return "vacia";
      }
    }

    const siguienteActivo = elegirMejorMiembroListo(estadoCompuesto);
    if (siguienteActivo) {
      activarMiembro(estadoCompuesto, siguienteActivo);
      return "sigue";
    }
    return estadoCompuesto.miembros.every((m) => m.estado === "terminado") ? "terminada" : "vacia";
  }

  /**
   * Análogo, para unidades compuestas (grupos ULT), del paso que hace
   * pasar a "listo" a quien arriba en este instante (ver el mismo paso
   * para unidades simples en simularPorInstantes) — pero acá hay que
   * revisar cada MIEMBRO por separado, porque no todos tienen por qué
   * arribar junto con la unidad compuesta (el primero en llegar es el que
   * determina el arribo "oficial" de la unidad — ver
   * construirUnidadesPlanificables — y los demás se suman al grupo más
   * tarde, cada uno en su propio instante):
   *
   *   - Si la unidad compuesta todavía es "nueva" (es el primer miembro
   *     que arriba de todo el grupo), pasa a "listo" igual que una unidad
   *     simple arribando.
   *   - Si la unidad compuesta ya venía funcionando pero se había quedado
   *     sin ningún miembro listo ("esperando-miembros"), este nuevo
   *     arribo la reactiva.
   *   - Si la unidad compuesta ya está lista/ejecutando, el nuevo miembro
   *     simplemente se suma al pool interno: no hay nada más que hacer,
   *     ya lo va a encontrar elegirSiguienteMiembroListo cuando le toque.
   *
   * Resuelve el arribo de UNA unidad compuesta puntual — se llama por cada
   * unidad, no de una sola vez para toda `estados`, para que quien arma el
   * paso 1 de cada motor pueda intercalarla con el chequeo de arribo de
   * las unidades simples EN UN SOLO recorrido de `estados`: así se
   * preserva el orden real de la lista (que es lo que se usa como
   * desempate final, `ordenEncolado`, entre quienes arriban en el mismo
   * instante) — si se hicieran dos recorridos separados (uno para simples,
   * otro para compuestas), ese orden se mezclaría mal.
   *
   * @param {Function} marcarListo - (estado, motivo) => void, del motor que llama.
   */
  function resolverArriboDeCompuesta(estadoCompuesto, instante, marcarListo) {
    let alguienLlego = false;
    estadoCompuesto.miembros.forEach((m) => {
      if (m.estado === "no-llegado" && m.arribo === instante) {
        m.estado = "listo";
        marcarMiembroListoInterno(estadoCompuesto, m, instante);
        alguienLlego = true;
      }
    });
    if (!alguienLlego) return;

    if (estadoCompuesto.estado === "listo" || estadoCompuesto.estado === "ejecutando" || estadoCompuesto.estado === "terminado") return;

    // Biblioteca "manejada por el SO" o "por la biblioteca" (bloqueaGrupo):
    // si el grupo está bloqueado esperando a un miembro puntual, el
    // arribo de UN HILO NUEVO no lo despierta — para el SO, el proceso
    // entero sigue en E/S hasta que
    // vuelva justo ese miembro (ver resolverFinRafagaCompuesta).
    if (estadoCompuesto.bloqueaGrupo && estadoCompuesto.miembroBloqueanteId != null) return;

    activarMiembro(estadoCompuesto, elegirMejorMiembroListo(estadoCompuesto));
    marcarListo(estadoCompuesto, "arribo");
  }

  /**
   * Análogo, para unidades compuestas (grupos ULT), del paso que hace
   * volver a "listo" a quien termina su IO en este instante (ver el mismo
   * paso para unidades simples más abajo en simularPorInstantes) — pero
   * acá hay que revisar cada MIEMBRO por separado, y solo si la unidad
   * compuesta se había quedado sin ningún miembro listo (resultado "vacia"
   * de resolverFinRafagaCompuesta) hace falta reingresarla a la cola de
   * listos del SO.
   *
   * @param {Function} marcarListo - (estado, motivo) => void, del motor que llama.
   * @param {?Function} obtenerMotivo - (estado) => string, motivo a usar al
   *        reingresar a listos. Por defecto siempre "io" — la usa Round
   *        Robin Virtual para poder decidir, según `agotoQuantumAlIrseAIO`,
   *        si el grupo reingresa por la cola prioritaria o por la normal
   *        (ver el mismo mecanismo para unidades simples en
   *        round-robin-virtual.js). El motor genérico no la pasa: acá el
   *        motivo solo afecta el desempate dentro de una única cola, no
   *        hay dos colas que elegir.
   */
  function resolverRetornosDeIOCompuestos(estados, instante, marcarListo, obtenerMotivo) {
    const motivoDeRetorno = obtenerMotivo || (() => "io");
    estados.forEach((e) => {
      if (!e.esCompuesta || e.estado === "terminado") return;

      let alguienQuedoListo = false;
      let elBloqueanteVolvio = false;
      let miembroBloqueanteQueVolvio = null;
      e.miembros.forEach((m) => {
        if (m.estado === "io" && m.instanteFinIO === instante) {
          m.indiceRafaga += 1;
          if (m.indiceRafaga >= m.rafagas.length) {
            m.estado = "terminado";
          } else {
            m.estado = "listo";
            marcarMiembroListoInterno(e, m, instante);
            alguienQuedoListo = true;
            if (m.id === e.miembroBloqueanteId) {
              elBloqueanteVolvio = true;
              miembroBloqueanteQueVolvio = m;
            }
          }
        }
      });

      if (e.estado === "listo" || e.estado === "ejecutando") return;
      if (!alguienQuedoListo) {
        if (e.miembros.every((m) => m.estado === "terminado")) {
          e.estado = "terminado";
          e.instanteTerminacion = instante;
        }
        return;
      }

      // Biblioteca "manejada por el SO" o "por la biblioteca" (bloqueaGrupo):
      // aunque algún otro miembro se haya puesto "listo" recién, el grupo
      // sigue bloqueado hasta que vuelva JUSTO el miembro cuya E/S tiene
      // ocupado al SO.
      if (e.bloqueaGrupo && e.miembroBloqueanteId != null && !elBloqueanteVolvio) return;

      e.miembroBloqueanteId = null;

      // Si quien volvió es JUSTO el miembro cuya E/S tenía bloqueado a todo
      // el grupo, retoma él mismo directamente — como si el SO le devolviera
      // el control a la llamada bloqueante que acaba de terminar (que es
      // literalmente lo que pasó). NO se vuelve a evaluar el algoritmo
      // interno acá: aunque algún otro hilo lleve esperando más tiempo, la
      // biblioteca recién tiene la oportunidad de decidir de nuevo en el
      // PRÓXIMO tick (ver resolverPreempcionInternaCompuesta para SRTF, que
      // sí lo desalojaría ahí mismo si corresponde) — no en el instante
      // exacto en que la E/S termina.
      //
      // Si en cambio no hay un miembro bloqueante puntual (grupo que no
      // estaba bloqueado por nadie en particular — hoy no pasa, porque
      // bloqueaGrupo es siempre true, pero queda listo para cuando
      // Jacketing exista de verdad y varios miembros puedan estar en E/S
      // en paralelo), sí corresponde que decida el algoritmo interno.
      //
      // OJO: hay que llamar a activarMiembro SIEMPRE acá (en cualquiera de
      // los dos casos), incluso si el miembro elegido es el mismo que ya
      // estaba marcado como activo — es lo que resincroniza
      // `rafagas`/`indiceRafaga` de la unidad compuesta con el
      // `indiceRafaga` que el miembro acaba de avanzar (arriba); si se lo
      // saltea, `indiceRafaga` queda apuntando a la ráfaga de CPU ya
      // terminada (no a la siguiente), y como su `restante` ya está en 0,
      // la unidad nunca vuelve a detectar "fin de ráfaga" — bucle infinito.
      activarMiembro(e, miembroBloqueanteQueVolvio || elegirMejorMiembroListo(e));
      marcarListo(e, motivoDeRetorno(e));
    });
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

  /**
   * Calcula espera/retorno/respuesta a partir de los estados finales de la
   * simulación — una fila por UNIDAD planificable (ver
   * construirUnidadesPlanificables): cada hilo KLT independiente y cada
   * grupo ULT compuesto tienen la suya, ningún hilo tiene trato especial.
   */
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
    const dispositivoIO = new ColaDispositivosIO();
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
      // 1) Arribos nuevos en este instante. Las unidades compuestas (grupos
      //    ULT) no arriban todas de una: sus miembros pueden hacerlo en
      //    instantes distintos entre sí, así que se resuelven aparte (ver
      //    resolverArriboDeCompuesta) — pero EN EL MISMO recorrido que las
      //    simples, no en uno separado, para no alterar el orden real de
      //    `estados` (el desempate final entre arribos simultáneos).
      estados.forEach((e) => {
        if (e.esCompuesta) resolverArriboDeCompuesta(e, instante, marcarListo);
        else if (e.estado === "nuevo" && e.arribo === instante) marcarListo(e, "arribo");
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

      // 2.1) Planificación INTERNA de una unidad compuesta (biblioteca ULT
      //      "biblioteca" con algoritmo "srtf"): esta expropiación es
      //      invisible para el SO, así que se resuelve aparte, DESPUÉS de
      //      que el SO ya decidió a quién le da la CPU (arriba) pero ANTES
      //      de ejecutar el tick — decide, de entre los hilos ULT del
      //      proceso elegido, cuál de ellos es el que realmente ejecuta.
      if (procesoEjecutando && procesoEjecutando.esCompuesta) {
        resolverPreempcionInternaCompuesta(procesoEjecutando, instante);
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
      let terminoRafagaEsteTick = false;
      // Caso borde SOLO relevante para unidades compuestas: la ráfaga del
      // miembro activo terminó justo en el mismo tick en que también se
      // agotó el quantum EXTERNO (del algoritmo elegido en "Ver
      // algoritmos", que planifica al PROCESO entero, no a cada hilo). Si
      // la biblioteca tiene otro hilo listo para seguir ("sigue" en
      // resolverFinRafagaCompuesta más abajo), el cambio de hilo es
      // invisible para el SO — pero el SO YA le agotó su turno al proceso,
      // así que igual hay que devolverle la CPU (a otro proceso, o a un
      // hilo KLT que esté esperando, tratado como un proceso más) antes de
      // que la biblioteca retome con su hilo siguiente.
      let agotoQuantumJustoAlTerminarRafaga = false;

      if (procesoEjecutando) {
        const e = procesoEjecutando;
        const rafagaActual = e.rafagas[e.indiceRafaga];
        rafagaActual.restante -= 1;
        gantt.push({ proceso: idEjecutable(e), inicio: instante, fin: instante + 1, tipo: "CPU" });
        if (quantum !== null) e.quantumRestante -= 1;

        // Estado justo después de ejecutar este tick — es lo mismo que se
        // usa en el próximo instante para decidir si hay que desalojarlo,
        // así que tiene sentido mostrárselo al alumno en esta misma celda.
        if (capturarInfoEjecucion) {
          if (!infoEjecucionPorInstante[instante]) infoEjecucionPorInstante[instante] = {};
          infoEjecucionPorInstante[instante][idEjecutable(e)] = capturarInfoEjecucion(e, instante);
        }

        terminoRafagaEsteTick = rafagaActual.restante === 0;
        const agotoQuantum = quantum !== null && !terminoRafagaEsteTick && e.quantumRestante === 0;
        agotoQuantumJustoAlTerminarRafaga = quantum !== null && terminoRafagaEsteTick && e.quantumRestante === 0;

        if (terminoRafagaEsteTick) {
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

      // 5.1) Planificación INTERNA de una unidad compuesta (biblioteca ULT
      //      "biblioteca" con algoritmo "round-robin"): descuenta el
      //      quantum interno del miembro que acaba de ejecutar y, si se
      //      agotó (y su ráfaga no terminó también en este mismo tick, ver
      //      `transicion === "fin-rafaga"`), lo desaloja de sus hermanos.
      //      Invisible para el SO: no toca `procesoEjecutando`, así que no
      //      importa si después, más abajo, el SO igual lo desaloja por
      //      SU PROPIO quantum ("fin-quantum") — la biblioteca ya habrá
      //      rotado a su siguiente hilo para la próxima vez que le toque.
      if (procesoEjecutando && procesoEjecutando.esCompuesta) {
        resolverQuantumInternoCompuesta(procesoEjecutando, terminoRafagaEsteTick, instante);
      }

      // 6) Resolver, ya en el nuevo instante, la transición del proceso que ocupó la CPU.
      if (transicion === "fin-rafaga") {
        const e = procesoEjecutando;
        if (e.esCompuesta) {
          // Grupo de hilos ULT: si otro hilo del mismo proceso puede seguir
          // usando la CPU de inmediato, el SO ni se entera del cambio (no
          // pasa por el planificador ni resetea el quantum) — solo si NO
          // queda ninguno listo, la unidad compuesta le devuelve la CPU al SO.
          const resultado = resolverFinRafagaCompuesta(e, dispositivoIO, instante, franjasIO, actualizarEstimacion, duracionRafagaQueTermino);
          if (resultado === "sigue" && agotoQuantumJustoAlTerminarRafaga) {
            // Otro hilo de la biblioteca sigue listo (el cambio en sí es
            // invisible para el SO), PERO el quantum del proceso, como un
            // todo, se agotó justo en este mismo tick — así que el SO le
            // devuelve la CPU igual, como si hubiera sido un fin de
            // quantum normal. La próxima vez que le toque el turno,
            // retoma con el hilo que "sigue" ya dejó activo.
            marcarListo(e, "desalojado");
            e.quantumRestante = null;
            procesoEjecutando = null;
          } else if (resultado !== "sigue") {
            if (resultado === "terminada") {
              e.estado = "terminado";
              e.instanteTerminacion = instante;
            } else {
              e.estado = "esperando-miembros";
            }
            e.quantumRestante = null;
            procesoEjecutando = null;
          }
        } else {
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
            const nombreDispositivo = nombreDispositivoDe(siguiente);
            const { inicio, fin } = dispositivoIO.solicitar(nombreDispositivo, siguiente.duracion, instante);
            e.estado = "io";
            e.instanteFinIO = fin;
            franjasIO.push({ proceso: e.id, inicio, fin, dispositivo: nombreDispositivo });
          }
          e.quantumRestante = null;
          procesoEjecutando = null;
        }
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
      resolverRetornosDeIOCompuestos(estados, instante, marcarListo);
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
    ColaDispositivosIO,
    nombreDispositivoDe,
    crearEstadoInicial,
    idEjecutable,
    resolverFinRafagaCompuesta,
    resolverArriboDeCompuesta,
    resolverRetornosDeIOCompuestos,
    resolverPreempcionInternaCompuesta,
    resolverQuantumInternoCompuesta,
    consolidarGantt,
    calcularMetricas,
    simularPorInstantes,
    reestimarRafaga,
  };
})();
