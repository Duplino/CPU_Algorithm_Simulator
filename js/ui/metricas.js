/**
 * metricas.js — Tabla de métricas (espera, retorno, respuesta) por proceso,
 * con fila de promedios. Solo presentación: los valores ya vienen calculados
 * en `resultado.metricas` (ver simulador-core.js).
 */
const Metricas = (function () {
  "use strict";

  /** Qué significa cada métrica — se muestra con Tippy.js al pasar el mouse por su encabezado. */
  const EXPLICACION_METRICA = {
    Espera: "Tiempo total que el proceso pasó en la cola de listos, esperando la CPU (sin ejecutar ni hacer E/S).",
    Retorno: "Tiempo total desde que el proceso arriba hasta que termina: instante de terminación − arribo.",
    Respuesta: "Tiempo desde que el proceso arriba hasta la primera vez que entra a ejecutar: primera ejecución − arribo.",
  };

  /** Mismo mecanismo que GrillaGantt.aplicarTooltip: Tippy.js si está disponible, si no cae al `title` nativo. */
  function aplicarTooltipEncabezado(th, texto) {
    th.classList.add("item-con-tooltip");
    if (typeof tippy === "function") {
      tippy(th, { content: texto, theme: "simulador", placement: "top" });
    } else {
      th.title = texto;
    }
  }

  function renderizarMetricas(contenedor, metricas) {
    contenedor.innerHTML = "";
    const ids = Object.keys(metricas);
    if (ids.length === 0) return;

    const tabla = document.createElement("table");
    tabla.className = "tabla-metricas";

    const filaHeader = document.createElement("tr");
    ["Proceso", "Espera", "Retorno", "Respuesta"].forEach((texto) => {
      const th = document.createElement("th");
      th.textContent = texto;
      if (EXPLICACION_METRICA[texto]) aplicarTooltipEncabezado(th, EXPLICACION_METRICA[texto]);
      filaHeader.appendChild(th);
    });
    tabla.appendChild(filaHeader);

    let sumaEspera = 0;
    let sumaRetorno = 0;
    let sumaRespuesta = 0;

    ids.forEach((id) => {
      const m = metricas[id];
      sumaEspera += m.espera;
      sumaRetorno += m.retorno;
      sumaRespuesta += m.respuesta;

      const fila = document.createElement("tr");
      [id, m.espera, m.retorno, m.respuesta].forEach((valor) => {
        const td = document.createElement("td");
        td.textContent = valor;
        fila.appendChild(td);
      });
      tabla.appendChild(fila);
    });

    const n = ids.length;
    const filaPromedio = document.createElement("tr");
    filaPromedio.className = "fila-promedio";
    ["Promedio", (sumaEspera / n).toFixed(2), (sumaRetorno / n).toFixed(2), (sumaRespuesta / n).toFixed(2)].forEach(
      (valor) => {
        const td = document.createElement("td");
        td.textContent = valor;
        filaPromedio.appendChild(td);
      }
    );
    tabla.appendChild(filaPromedio);

    contenedor.appendChild(tabla);
  }

  return { renderizarMetricas };
})();
