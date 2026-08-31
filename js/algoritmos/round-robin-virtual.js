/**
 * round-robin-virtual.js — Round Robin Virtual (variante con cola de reingreso).
 *
 * A diferencia del Round Robin clásico, acá NO hay una única cola de listos:
 * hay dos colas separadas y la de reingreso tiene prioridad ABSOLUTA sobre
 * la normal:
 *
 *   - Cola de reingreso: procesos que vuelven de una ráfaga de IO. Cuando la
 *     CPU queda libre, primero se mira esta cola; si tiene algún proceso, se
 *     atiende antes que cualquiera de la cola normal.
 *   - Cola normal: arribos nuevos y procesos que agotaron su quantum
 *     (desalojados). Solo se atiende si la cola de reingreso está vacía.
 *
 * Además, un proceso que vuelve de IO reingresa con el quantum QUE LE
 * QUEDABA antes de irse a IO (no recupera un quantum completo) — esto es lo
 * que le da el nombre "virtual" a la variante. En cambio, un proceso que
 * vuelve a la cola normal (porque agotó su quantum) sí recibe un quantum
 * nuevo y completo la próxima vez que entra a CPU.
 *
 * Por esta estructura de dos colas, este algoritmo no reutiliza el motor
 * genérico de simulador-core.js (pensado para una única cola con desempate
 * uniforme); sí reutiliza de ahí el dispositivo de IO y los helpers de
 * consolidación de gantt / cálculo de métricas.
 */
function simularRoundRobinVirtual(procesos, opciones) {
  const quantum = opciones && opciones.quantum != null ? opciones.quantum : 1;

  const estados = SimuladorCore.crearEstadoInicial(procesos);
  const dispositivoIO = new SimuladorCore.ColaDispositivoIO();
  const gantt = [];
  const franjasIO = [];
  const colaListosPorInstante = {};
  const colasPorInstante = {};

  const LIMITE_SEGURIDAD = 100000;
  let contadorEncolado = 0;
  let instante = 0;
  let procesoEjecutando = null;

  const marcarListo = (estado, motivo) => {
    estado.estado = "listo";
    estado.motivoIngreso = motivo;
    estado.ordenEncolado = contadorEncolado++;
    estado.instanteEntradaAListos = instante;
  };

  const esDeReingreso = (e) => e.motivoIngreso === "io";

  while (estados.some((e) => e.estado !== "terminado") && instante < LIMITE_SEGURIDAD) {
    // 1) Arribos nuevos en este instante (van a la cola normal). Las
    //    unidades compuestas (grupos ULT) se resuelven aparte, en el MISMO
    //    recorrido (ver el mismo comentario en simulador-core.js).
    estados.forEach((e) => {
      if (e.esCompuesta) SimuladorCore.resolverArriboDeCompuesta(e, instante, marcarListo);
      else if (e.estado === "nuevo" && e.arribo === instante) marcarListo(e, "arribo");
    });

    // 2) Selección: la cola de reingreso (vuelven de IO) tiene prioridad
    //    absoluta sobre la cola normal (arribos + desalojados por quantum).
    if (procesoEjecutando === null) {
      const listos = estados.filter((e) => e.estado === "listo");
      const reingreso = listos.filter(esDeReingreso);
      const normal = listos.filter((e) => !esDeReingreso(e));

      let elegido = null;
      let vieneDeReingreso = false;
      if (reingreso.length > 0) {
        elegido = SimuladorCore.ordenarColaListos(reingreso, instante, null)[0];
        vieneDeReingreso = true;
      } else if (normal.length > 0) {
        elegido = SimuladorCore.ordenarColaListos(normal, instante, null)[0];
      }

      if (elegido) {
        procesoEjecutando = elegido;
        elegido.estado = "ejecutando";
        if (elegido.primeraEjecucion === null) elegido.primeraEjecucion = instante;
        // Reingreso: conserva el quantum que le quedaba antes de ir a IO.
        // Cola normal: siempre arranca con un quantum nuevo y completo.
        // Si el leftover es 0 (agotó el quantum justo cuando terminó la
        // ráfaga de CPU y pasó a IO), no hay nada que conservar: se le da
        // un quantum nuevo, igual que si viniera de la cola normal.
        if (!vieneDeReingreso || elegido.quantumRestante == null || elegido.quantumRestante <= 0) {
          elegido.quantumRestante = quantum;
        }
      }
    }

    // 3) Cola de listos para la UI. Acá no hay una única cola: se registran
    //    las dos por separado (reingreso y normal), sin el proceso que está
    //    ejecutando (ni el que está en IO, que ni siquiera está en `listos`).
    //    Los de reingreso llevan además el quantum que les queda — es el
    //    dato que distingue a esta variante ("virtual"), así que tiene
    //    sentido mostrarlo junto a esa cola en particular.
    {
      const listos = estados.filter((e) => e.estado === "listo");
      const reingresoOrdenado = SimuladorCore.ordenarColaListos(listos.filter(esDeReingreso), instante, null);
      const normalOrdenado = SimuladorCore.ordenarColaListos(listos.filter((e) => !esDeReingreso(e)), instante, null);

      colasPorInstante[instante] = {
        // Si el leftover es 0 (ver el mismo caso borde de la sección 2), en
        // los hechos va a reingresar con un quantum nuevo y completo — así
        // que eso es lo que hay que mostrar, no un "(0)" engañoso.
        reingreso: reingresoOrdenado.map((e) => ({
          id: e.id,
          restante: e.quantumRestante > 0 ? e.quantumRestante : quantum,
        })),
        normal: normalOrdenado.map((e) => e.id),
      };
      colaListosPorInstante[instante] = [...colasPorInstante[instante].reingreso.map((e) => e.id), ...colasPorInstante[instante].normal];
    }

    // 4) Ejecutar la unidad de tiempo [instante, instante+1). Igual que en
    //    el motor genérico: las transiciones (fin de ráfaga, fin de
    //    quantum) se resuelven DESPUÉS de avanzar el reloj, para que
    //    queden fechadas en el instante en que realmente ocurren
    //    (instante+1), no en el instante en que arrancó el tick.
    let transicion = null; // 'fin-rafaga' | 'fin-quantum' | null

    if (procesoEjecutando) {
      const e = procesoEjecutando;
      const rafagaActual = e.rafagas[e.indiceRafaga];
      rafagaActual.restante -= 1;
      gantt.push({ proceso: SimuladorCore.idEjecutable(e), inicio: instante, fin: instante + 1, tipo: "CPU" });
      e.quantumRestante -= 1;

      const terminoRafaga = rafagaActual.restante === 0;
      const agotoQuantum = !terminoRafaga && e.quantumRestante === 0;

      if (terminoRafaga) transicion = "fin-rafaga";
      else if (agotoQuantum) transicion = "fin-quantum";
    } else {
      gantt.push({ proceso: null, inicio: instante, fin: instante + 1, tipo: "IDLE" });
    }

    estados.forEach((e) => {
      if (e.estado === "listo") e.ticksListo += 1;
    });

    instante += 1;

    // 5) Resolver, ya en el nuevo instante, la transición del proceso que ocupó la CPU.
    if (transicion === "fin-rafaga") {
      const e = procesoEjecutando;
      if (e.esCompuesta) {
        // Grupo de hilos ULT: igual criterio que en simulador-core.js — si
        // otro hilo del mismo proceso puede seguir de inmediato, el SO ni
        // se entera (no pasa por el planificador ni toca el quantum).
        const resultado = SimuladorCore.resolverFinRafagaCompuesta(e, dispositivoIO, instante, franjasIO, null, null);
        if (resultado === "terminada") {
          e.estado = "terminado";
          e.instanteTerminacion = instante;
          e.quantumRestante = null;
          procesoEjecutando = null;
        } else if (resultado === "vacia") {
          e.estado = "esperando-miembros";
          // No se resetea quantumRestante: igual que con una IO simple, se
          // conserva para cuando reingrese por la cola de reingreso.
          procesoEjecutando = null;
        }
        // "sigue": no se toca procesoEjecutando ni quantumRestante.
      } else {
        e.indiceRafaga += 1;
        if (e.indiceRafaga >= e.rafagas.length) {
          e.estado = "terminado";
          e.instanteTerminacion = instante;
          e.quantumRestante = null;
        } else {
          const siguiente = e.rafagas[e.indiceRafaga];
          const { inicio, fin } = dispositivoIO.solicitar(siguiente.duracion, instante);
          e.estado = "io";
          e.instanteFinIO = fin;
          franjasIO.push({ proceso: e.id, inicio, fin });
          // No se resetea quantumRestante: es justamente lo que se "descuenta"
          // y se conserva para cuando reingrese por la cola de reingreso.
        }
        procesoEjecutando = null;
      }
    } else if (transicion === "fin-quantum") {
      marcarListo(procesoEjecutando, "desalojado");
      procesoEjecutando.quantumRestante = null; // vuelve por la cola normal -> quantum nuevo la próxima vez
      procesoEjecutando = null;
    }

    // 6) Los que terminan su IO en este nuevo instante entran a la cola de
    //    reingreso. Hay que avanzar el índice de ráfaga acá (ver el mismo
    //    comentario en simulador-core.js): si no, el proceso queda
    //    apuntando a la ráfaga de IO que recién terminó en vez de a la
    //    próxima ráfaga de CPU.
    estados.forEach((e) => {
      if (e.estado === "io" && e.instanteFinIO === instante) {
        e.indiceRafaga += 1;
        if (e.indiceRafaga >= e.rafagas.length) {
          e.estado = "terminado";
          e.instanteTerminacion = instante;
        } else {
          marcarListo(e, "io");
        }
      }
    });
    SimuladorCore.resolverRetornosDeIOCompuestos(estados, instante, marcarListo);
  }

  return {
    gantt: SimuladorCore.consolidarGantt(gantt),
    franjasIO,
    colaListosPorInstante,
    colasPorInstante,
    metricas: SimuladorCore.calcularMetricas(estados),
  };
}
