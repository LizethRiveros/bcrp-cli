// Widget real de pantalla de inicio para iPhone con la app gratuita Scriptable.
// Pega este código en un script nuevo, añade un widget de Scriptable y elige este script.
// Parámetro opcional del widget: ids separados por coma, por ejemplo "fx,euro,gold".
const URL_DATA = "https://lizethriveros.github.io/bcrp-cli/widget/data.json";
const ids = (args.widgetParameter || "fx,euro,inflation").split(",");
const data = await new Request(URL_DATA).loadJSON();
const w = new ListWidget();
w.backgroundColor = Color.dynamic(new Color("#f6f1e7"), new Color("#14181a"));
const fg = Color.dynamic(new Color("#231f18"), new Color("#f4f2ea"));
const muted = Color.dynamic(new Color("#6b6354"), new Color("#a9aea6"));
const n = Math.min(ids.length, config.widgetFamily === "small" ? 2 : 3);
for (const id of ids.slice(0, n)) {
  const t = data.topics.find((x) => x.id === id);
  if (!t) continue;
  const l = w.addText(t.label); l.font = Font.mediumSystemFont(11); l.textColor = muted;
  const v = w.addText(t.display); v.font = Font.semiboldRoundedSystemFont(22); v.textColor = fg;
  if (t.delta) {
    const d = w.addText((t.delta.up ? "▲ " : "▼ ") + t.delta.text);
    d.font = Font.mediumSystemFont(11); d.textColor = t.delta.up ? new Color("#c8691f") : new Color("#3f8a52");
  }
  w.addSpacer(6);
}
const f = w.addText("BCRP · " + data.updated); f.font = Font.systemFont(9); f.textColor = muted;
w.url = "https://lizethriveros.github.io/bcrp-cli/widget/";
Script.setWidget(w);
if (!config.runsInWidget) await w.presentSmall();
Script.complete();
