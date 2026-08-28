/**
 * metricas.js — Tabla de métricas (espera, retorno, respuesta) por proceso,
 * con fila de promedios. Solo presentación: los valores ya vienen calculados
 * en `resultado.metricas` (ver simulador-core.js).
 */
const Metricas = (function () {
  "use strict";

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
