import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await fs.readFile(path.join(root, "../assets/metis-mark.svg"), "utf8");
const mark = source.replace('fill="currentColor"', 'fill="#f5f5f5"').replace("<svg ", '<svg x="64" y="64" width="896" height="896" ');
const icon = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" rx="224" fill="#171717"/>' + mark + '</svg>';
await fs.mkdir(path.join(root, "assets"), { recursive: true });
const pngPath = path.join(root, "assets/icon.png");
await sharp(Buffer.from(icon)).png().toFile(pngPath);
await fs.writeFile(path.join(root, "assets/icon.ico"), await pngToIco(pngPath));
await sharp(Buffer.from(source.replace('fill="currentColor"', 'fill="#000000"'))).resize(64, 64).png().toFile(path.join(root, "assets/trayTemplate.png"));
console.log("METIS_M_ICONS_GENERATED");
