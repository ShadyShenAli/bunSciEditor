#!/c/TEMP/bun/bin/bun.exe
const INDIC_ID         = 8;
const INDIC_STRAIGHTBOX = 8;
const YELLOW           = 0x0000FFFF; // COLORREF R=255 G=255 B=0

export default function(api) {
  let lastSel    = '';
  let indicSetup = false;

  function setupIndicator() {
    if (indicSetup) return;
    indicSetup = true;
    api.sci.setIndicatorStyle(INDIC_ID, INDIC_STRAIGHTBOX);
    api.sci.setIndicatorFore(INDIC_ID, YELLOW);
    api.sci.setIndicatorAlpha(INDIC_ID, 80);
    api.sci.setIndicatorUnder(INDIC_ID, true);
  }

  function clearHighlights() {
    api.sci.clearIndicator(INDIC_ID);
  }

  function highlightAll(word) {
    setupIndicator();
    const matches = api.sci.findAll(word, api.SCFIND.MATCHCASE);
    for (const { start, end } of matches) {
      api.sci.fillIndicator(INDIC_ID, start, end - start);
    }
  }

  api.on('cursorMove', () => {
    const trimmed = api.sci.getSelText().replace(/[\r\n]/g, '');
    if (trimmed === lastSel) return;
    lastSel = trimmed;
    clearHighlights();
    if (trimmed.length >= 2) highlightAll(trimmed);
  });

  api.on('change', () => {
    lastSel = '';
    clearHighlights();
  });
}
