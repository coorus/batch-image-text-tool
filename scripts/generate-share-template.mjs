import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const [page, css, js, icon] = await Promise.all([
  readFile(path.join(dist, "index.html"), "utf8"),
  readFile(path.join(dist, "assets/batch-image-text-tool.css"), "utf8"),
  readFile(path.join(dist, "assets/batch-image-text-tool.js"), "utf8"),
  readFile(path.join(dist, "assets/app-icon.svg"), "utf8")
]);

if (/<\/style/i.test(css) || /<\/script/i.test(js)) throw new Error("内联资源包含 HTML 结束标签，无法安全生成共享模板");
const stylesheet = /<link rel="stylesheet" href="\/?assets\/batch-image-text-tool\.css\?v=[^"]+">/;
const script = /<script src="\/?assets\/batch-image-text-tool\.js\?v=[^"]+"><\/script>/;
const favicon = /<link rel="icon" type="image\/svg\+xml" href="\/?assets\/app-icon\.svg">/;
if (!stylesheet.test(page) || !script.test(page) || !favicon.test(page)) throw new Error("找不到共享模板需要的入口资源");

const template = page
  .replace(favicon, `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(icon)}">`)
  .replace(stylesheet, `<style>\n${css}\n</style>`)
  .replace(script, `<!--SHARED_PRESET_BOOTSTRAP-->\n<script>\n${js}\n</script>`);

const output = `// 由 scripts/generate-share-template.mjs 生成；更新入口或资源后请重新运行。\nwindow.__BATCH_IMAGE_TEXT_SHARE_TEMPLATE__ = ${JSON.stringify(template)};\n`;
await writeFile(path.join(dist, "assets/share-template.js"), output, "utf8");
console.log(`共享网页模板已生成：${Buffer.byteLength(template)} 字节`);
