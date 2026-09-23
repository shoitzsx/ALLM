# Fixtures de teste — CODE_128 sintético

Imagens de um código de barras CODE_128C real (não um mock/desenho
aproximado) codificando uma **chave de NF-e sintética, com dígito
verificador válido**, usadas para validar o decoder de barcode do módulo
contra pixels reais — coisa que `npm test` sozinho não cobre, porque
`readCode128FromCanvas` (barcodeReader.js) precisa de Canvas DOM, que o
runner nativo do Node não tem.

## Chave sintética usada

```
42260112345678000199550010000000011000000014
```

Passa em `validarChaveNFe()` (dígito verificador módulo 11 confere), mas o
CNPJ (`12345678000199`) e os demais campos são inventados — **não é uma NF
real**, só uma sequência de 44 dígitos matematicamente válida para gerar um
barcode de teste.

## Como as fixtures foram geradas

Com `jsbarcode` + `canvas` (node-canvas), rodados uma única vez fora do
projeto (instalados só num diretório de trabalho temporário, **nunca**
adicionados como dependência do app — isto é ferramenta de build das
fixtures, não código que roda em produção). Cada arquivo aplica uma
transformação diferente sobre o mesmo barcode-base:

| Arquivo | O que testa |
|---|---|
| `clean.png` | Caso ideal: margem generosa, sem inclinação. |
| `tight-margin.png` | Margem pequena (~2px por lado no render original). |
| `zero-margin.png` | Barras tocando a borda da imagem — recorte exatamente no primeiro/último pixel escuro, zero quiet zone real. |
| `rotated-90deg.png` | Rotação cardeal de 90° (câmera/foto em orientação diferente). |
| `low-res.png` | Módulo de barra de 1px (mais estreito que o padrão de 2px das outras fixtures). |
| `low-contrast.png` | Barras cinza (`#555`) sobre fundo quase branco (`#e8e8e8`), em vez de preto sobre branco. |
| `tilted-2deg.png`, `tilted-6deg.png`, `tilted-10deg.png` | Pequenas inclinações — ver "O que a investigação encontrou" abaixo. |
| `tight-margin-tilted-4deg.png` | Margem pequena **e** inclinação combinadas — o caso mais parecido com o bug real reproduzido (foto só da região do código, ligeiramente torta). |

## O que a investigação encontrou (antes de implementar o estágio de deskew)

Testado contra o pipeline **antes** desta rodada de melhorias, com o mesmo
barcode em várias inclinações:

| Inclinação da fonte | Decodificava? |
|---|---|
| 0°–2° | Sim |
| 3°–10° | Não, em nenhum caso testado |

Ou seja: o pipeline **sempre** decodificava até ~2° de desvio de câmera e
**nunca** decodificava a partir de 3° — não era um problema de sorte, era um
limite real e reproduzível. Isso motivou o estágio de deskew em
`barcodeReader.js` (`DESKEW_ANGLES`).

**Depois** do estágio de deskew, testado com o mesmo conjunto: recupera a
maioria dos casos entre 3° e 10° (`tilted-6deg.png`, por exemplo, passa a
decodificar), mas não 100% — `tilted-10deg.png` continua falhando com o
conjunto de ângulos atual (`[-11, -8, -5, -3, 3, 5, 8, 11]`), porque o efeito
de reamostragem do canvas em cada ângulo específico não é perfeitamente
previsível (ver comentário no topo de `barcodeReader.js`). Isso está
documentado como limitação conhecida, não escondido.

## Como rodar a validação

```bash
# 1. Servidor de dev rodando (outro terminal):
npm run dev

# 2. Driver do Playwright, só para esta validação (não fica no projeto):
npm install --no-save playwright-core

# 3. Rodar:
node src/features/nfeReader/testFixtures/validate-fixtures.mjs
```

O script (`validate-fixtures.mjs`) abre uma aba real, desenha cada fixture
num `<canvas>` e chama o `readCode128FromCanvas` de verdade — não uma
simulação da lógica. Cada fixture tem uma expectativa (`shouldDecode`)
documentada no próprio script, incluindo a falha conhecida de
`tilted-10deg.png`.

Variáveis de ambiente opcionais: `NFE_DEV_SERVER_URL` (padrão
`http://localhost:5173`) e `NFE_CHROME_PATH` (padrão o Chrome instalado em
`C:/Program Files/Google/Chrome/Application/chrome.exe` no Windows — ajuste
para o caminho do Chrome/Chromium na sua máquina).

## O que isto NÃO substitui

Câmera real, autofoco, distância, iluminação, reflexo e o comportamento de
cada navegador em aparelho físico continuam exigindo teste manual num
celular de verdade — ver a seção "Como testar com o celular" no
[README do módulo](../README.md). Estas fixtures provam que o **algoritmo**
de decodificação funciona para os padrões de pixel testados; não provam nada
sobre captura de câmera ao vivo.
