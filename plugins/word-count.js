#!/c/TEMP/bun/bin/bun.exe
export default function(api) {
  api.addMenuItem('Show Stats', 'Ctrl+Shift+W', () => {
    const text  = api.sci.getText();
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const lines = api.sci.getLineCount();
    api.alert(`Lines: ${lines}\nWords: ${words}\nChars: ${text.length}`);
  });
}
