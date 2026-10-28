/**
 * Regiões retangulares da página, em proporção do canvas (nunca pixels
 * fixos, para não depender do tamanho/layout de uma NF específica) —
 * compartilhadas pela leitura de código de barras (`barcodeReader.js`) e
 * pelo OCR (`ocrReader.js`), para que as duas engines concordem sobre o que
 * significa, por exemplo, "topo direito" de um DANFE. Antes desta extração,
 * cada arquivo tinha sua própria lista de recortes — o OCR nem tentava
 * "topo direito" (só "topo 35%" e "página inteira"), então uma chave só
 * ilegível nessas duas regiões nunca tinha chance, mesmo se "topo direito"
 * (já usada pelo código de barras) a contivesse de forma mais limpa.
 *
 * Pura geometria — sem `document`/Canvas, testável em Node puro
 * (`pageRegions.test.mjs`).
 */

export const PAGE_REGIONS = {
  topo25: {
    label: 'topo 25%',
    region: (width, height) => ({ x: 0, y: 0, width, height: Math.round(height * 0.25) }),
  },
  topo35: {
    label: 'topo 35%',
    region: (width, height) => ({ x: 0, y: 0, width, height: Math.round(height * 0.35) }),
  },
  topoDireito: {
    label: 'topo direito',
    region: (width, height) => ({
      x: Math.round(width * 0.35),
      y: 0,
      width: Math.round(width * 0.65),
      height: Math.round(height * 0.35),
    }),
  },
  topoEsquerdo: {
    label: 'topo esquerdo',
    region: (width, height) => ({ x: 0, y: 0, width: Math.round(width * 0.65), height: Math.round(height * 0.35) }),
  },
  metadeSuperior: {
    label: 'metade superior',
    region: (width, height) => ({ x: 0, y: 0, width, height: Math.round(height * 0.5) }),
  },
  // `region: null` é o sinal (já usado antes desta extração) de "não recortar
  // — usar a imagem inteira"; ambos os pipelines pulam este item quando já
  // trataram a imagem inteira num estágio anterior.
  paginaInteira: { label: 'página inteira', region: null },
}

/**
 * Ordem de tentativa do código de barras: `topoDireito` primeiro — é onde o
 * DANFE costuma posicionar o código de barras e a chave impressa — seguida
 * pelas regiões de sempre, da mais barata/específica para a página inteira.
 * Mudar só a ORDEM aqui não muda quantas tentativas são feitas (mesmas 6
 * regiões de sempre), só qual é tentada primeiro.
 */
export const BARCODE_CROP_ORDER = [
  PAGE_REGIONS.topoDireito,
  PAGE_REGIONS.topo25,
  PAGE_REGIONS.topo35,
  PAGE_REGIONS.topoEsquerdo,
  PAGE_REGIONS.metadeSuperior,
  PAGE_REGIONS.paginaInteira,
]

/**
 * Ordem de tentativa do OCR — deliberadamente menor que a do código de
 * barras (OCR é bem mais lento por tentativa): `topoDireito` (nova, mais
 * restrita que "topo 35%" — menos texto irrelevante de outras colunas da
 * página) primeiro, depois as duas regiões de sempre como fallback. +1
 * região no total (de 2 para 3), não um salto grande — ver `ocrReader.js`.
 */
export const OCR_CROP_ORDER = [PAGE_REGIONS.topoDireito, PAGE_REGIONS.topo35, PAGE_REGIONS.paginaInteira]
