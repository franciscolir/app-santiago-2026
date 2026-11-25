// Configuración de SVGO para los iconos del mapa.
// Se usa desde scripts/optimizar-iconos.mjs (npx svgo --config scripts/svgo.config.mjs).
//
// - No se quita el viewBox: es lo que permite escalar el icono al mapa.
// - Se conservan width/height: el navegador necesita un tamaño intrínseco
//   para rasterizar el SVG a un canvas (icono de MapLibre).
// - convertPathData con 0 decimales: los trazos originales venían con 2
//   decimales y ocupaban 4,3 MB en total (ahora ~0,5 MB). El error máximo
//   (0,5 unidades sobre un viewBox de ~250-1200) es menor a 0,2 px en el
//   icono que se ve en el mapa: invisible.
// - cleanupNumericValues con 1 decimal: conserva grosores de trazo como
//   stroke-width=".3" (con 0 decimales desaparecerían).
export default {
  multipass: true,
  plugins: [
    {
      name: "preset-default",
      params: {
        overrides: {
          removeViewBox: false,
          removeTitle: false,
          convertPathData: { floatPrecision: 0, transformPrecision: 5, makeArcs: { threshold: 2.5 } },
          cleanupNumericValues: { floatPrecision: 1 },
          mergePaths: false,
          collapseGroups: true,
        },
      },
    },
  ],
};
