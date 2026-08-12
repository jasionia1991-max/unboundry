import { existsSync, readFileSync, realpathSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const applicationRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const allowedSourceRoots = ["server", "types"].map((directory) =>
  realpathSync(resolve(applicationRoot, directory))
);

function isInside(parent, child) {
  const difference = relative(parent, child);
  return difference === "" ||
    (!isAbsolute(difference) &&
      difference !== ".." &&
      !difference.startsWith(`..${sep}`));
}

function allowedSourcePath(url, requireExisting = true) {
  const parsed = new URL(url);
  if (parsed.protocol !== "file:") return undefined;
  const lexicalPath = fileURLToPath(parsed);
  if (!allowedSourceRoots.some((root) => isInside(root, lexicalPath))) {
    return undefined;
  }
  if (parsed.search || parsed.hash) {
    throw new Error("TypeScript operations modules cannot use query or hash aliases");
  }
  if (!requireExisting) return lexicalPath;
  const canonicalPath = realpathSync(lexicalPath);
  if (!allowedSourceRoots.some((root) => isInside(root, canonicalPath))) {
    throw new Error("TypeScript operations module escapes the allowed source roots");
  }
  if (canonicalPath !== lexicalPath) {
    throw new Error("TypeScript operations modules cannot be symbolic links");
  }
  return canonicalPath;
}

registerHooks({
  load(url, context, nextLoad) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "file:" ||
      extname(fileURLToPath(parsed)) !== ".ts"
    ) {
      return nextLoad(url, context);
    }
    const path = allowedSourcePath(url);
    if (!path) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(path, "utf8"), {
        mode: "transform",
        sourceMap: true,
        sourceUrl: url,
      }),
    };
  },
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        error?.code !== "ERR_MODULE_NOT_FOUND" ||
        !context.parentURL ||
        (!specifier.startsWith("./") && !specifier.startsWith("../")) ||
        extname(specifier) ||
        specifier.includes("?") ||
        specifier.includes("#") ||
        !allowedSourcePath(context.parentURL)
      ) {
        throw error;
      }
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      const lexicalPath = allowedSourcePath(candidate.href, false);
      if (!lexicalPath || !existsSync(lexicalPath)) throw error;
      const path = allowedSourcePath(candidate.href);
      if (!path) throw error;
      return { shortCircuit: true, url: pathToFileURL(path).href };
    }
  },
});
