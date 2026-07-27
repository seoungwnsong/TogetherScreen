import { copyFile, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extensionDirectory = resolve(scriptDirectory, "..");

async function findPackageRoot(packageName) {
  let current = dirname(require.resolve(packageName));
  const root = parse(current).root;

  while (current !== root) {
    const packageJsonPath = join(current, "package.json");

    try {
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
      if (packageJson.name === packageName) return current;
    } catch {
      // Continue searching parent directories.
    }

    current = dirname(current);
  }

  throw new Error(`Could not locate the ${packageName} package directory.`);
}

const packageRoot = await findPackageRoot("socket.io-client");
const source = join(packageRoot, "dist", "socket.io.min.js");
const destination = join(extensionDirectory, "socket.io.min.js");

await stat(source);
await copyFile(source, destination);
console.log(`Copied Socket.IO client to ${destination}`);
