// Main-thread client for the CAD worker. Builds are "latest wins": if the
// user keeps typing, older builds are dropped instead of queuing up.

let worker;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      data.ok ? p.resolve(data.result) : p.reject(new Error(data.error));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || "The 3D engine crashed. Reload the page."));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

function call(msg) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id });
  });
}

let latestBuild = 0;
/** Build a model; resolves null if a newer build superseded this one. */
export async function build(model, params) {
  const ticket = ++latestBuild;
  const result = await call({ type: "build", model, params });
  return ticket === latestBuild ? result : null;
}

/** Export the last built part ("tray", "lid", ... or "all") as stl or step. */
export async function exportPart(part, format) {
  const { blob, filename } = await call({ type: "export", part, format });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return filename;
}

/** Start loading the 3D engine early (it's a few MB of WebAssembly). */
export function warmUp() {
  getWorker();
}
