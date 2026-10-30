import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function assembleSite({ v1, v2, out }) {
  for (const name of ["v1", "v2"]) {
    try {
      await access(join(v2, name));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    throw new Error(`The current site already contains ${name}`);
  }
  await mkdir(out);
  await cp(v2, out, { recursive: true });
  await writeFile(join(out, ".nojekyll"), "");
  await cp(v1, join(out, "v1"), { recursive: true });
  await mkdir(join(out, "v2"));
  for (const name of ["install.sh", "install.ps1"]) {
    await cp(join(out, name), join(out, "v2", name));
  }
  await writeFile(
    join(out, "v2", "index.html"),
    `<!doctype html>
<meta charset="utf-8">
<title>APX</title>
<noscript><meta http-equiv="refresh" content="0; url=/"></noscript>
<script>location.replace("/"+location.search+location.hash)</script>
<link rel="canonical" href="https://apxagent.app/">
<a href="/">APX</a>
`,
  );
  const page = await readFile(join(out, "404.html"), "utf8");
  if (!page.includes("<head>")) throw new Error("The current 404 page has no head");
  const hop = `<script>{const p=location.pathname,r=location.search+location.hash;let target;if(p.startsWith("/apx/"))target=p.slice(4);else if(p.startsWith("/docs/"))target="/v1/"+p.slice(6);else if(p.startsWith("/v2/"))target="/"+p.slice(4);if(target){const url=new URL(target+r,location.origin);if(url.origin===location.origin)location.replace(url.href)}}</script>`;
  await writeFile(join(out, "404.html"), page.replace("<head>", `<head>${hop}`));
}
