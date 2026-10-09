/** Reuse Next's emitted Inter assets locally; never fetch fonts from the fixture. */
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function prepareFixtureFont(root, out) {
  const cssFiles=[];
  for(const directory of ["chunks","css"]){
    const folder=join(root,".next","static",directory);
    for(const file of await readdir(folder).catch(()=>[]))if(file.endsWith(".css"))cssFiles.push(join(folder,file));
  }
  if(!cssFiles.length)throw new Error("Next build assets are missing. Run npm run build before browser QA.");
  for (const file of cssFiles) {
    const css = await readFile(file, "utf8");
    const variable = css.match(/--font-inter:([^;}]+)/)?.[1];
    const faces = (css.match(/@font-face\{[^}]+\}/g) ?? []).filter((face) => /font-family:["']?Inter\b/.test(face));
    if (!variable || !faces.length) continue;
    const assets = [...new Set(faces.flatMap((face) => [...face.matchAll(/(?:\.\.\/media\/|\/_next\/static\/media\/)([A-Za-z0-9_.-]+\.woff2)/g)].map((match) => match[1])))];
    if (!assets.length || !variable.includes("Inter")) continue;
    await mkdir(join(out, "fonts"), { recursive: true });
    for (const asset of assets) await copyFile(join(root, ".next", "static", "media", asset), join(out, "fonts", asset));
    await writeFile(join(out, "font.css"), `${faces.join("\n").replaceAll("../media/", "/fonts/").replaceAll("/_next/static/media/", "/fonts/")}\n:root{--font-inter:${variable};}\n`);
    console.log(`Fixture typography: Inter from the current Next build (${assets.length} local font assets)`);
    return;
  }
  throw new Error("The current Next build did not expose identifiable Inter assets. Run npm run build before browser QA; do not silently replace typography.");
}
