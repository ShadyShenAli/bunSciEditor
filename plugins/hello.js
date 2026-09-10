#!/c/TEMP/bun/bin/bun.exe
export default function(api) {
  api.on('open', path => {
    console.log('[hello plugin] opened:', path);
  });

  api.addMenuItem('Insert Timestamp', () => {
    api.sci.replaceSelection(new Date().toISOString());
  });

  api.addMenuItem('UPPER CASE Selection', () => {
    const sel = api.sci.getSelText();
    if (sel) api.sci.replaceSelection(sel.toUpperCase());
  });

  api.addMenuItem('lower case Selection', () => {
    const sel = api.sci.getSelText();
    if (sel) api.sci.replaceSelection(sel.toLowerCase());
  });
}
