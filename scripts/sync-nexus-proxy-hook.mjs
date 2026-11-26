import { readFileSync, writeFileSync } from "node:fs";

const sourceRoot = new URL("../home/dot_local/bin/", import.meta.url);
const hook = new URL("post-installx/executable_post-nexus-cache.sh", sourceRoot);
const proxy = readFileSync(new URL("executable_megabyte-local-proxy.ts", sourceRoot), "utf8");
const current = readFileSync(hook, "utf8");
const marker = /(^cat <<'TSEOF' > "\$HOME\/\.local\/bin\/megabyte-local-proxy\.ts"\n)[\s\S]*?(^TSEOF$)/m;
if (!marker.test(current) || /^TSEOF$/m.test(proxy)) {
  throw new Error("Cannot locate or safely update the Nexus proxy heredoc");
}
const expected = current.replace(marker, (_match, opening, closing) => opening + proxy + closing);
if (process.argv.includes("--write")) {
  writeFileSync(hook, expected);
} else if (expected !== current) {
  process.stderr.write("Nexus provisioning hook drifted. Run node scripts/sync-nexus-proxy-hook.mjs --write.\n");
  process.exitCode = 1;
}
