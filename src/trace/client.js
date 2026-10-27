// Main-thread side of the tracing worker. Traces are "latest wins".
let worker;
let seq = 0;
const pending = new Map();

function get() {
  if (!worker) {
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      data.ok ? p.resolve(data.result) : p.reject(new Error(data.error));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || "The tracer stopped. Reload the page."));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

function call(msg, transfer = []) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    get().postMessage({ ...msg, id }, transfer);
  });
}

/** Send a new image (ImageData) to the tracer. */
export function setImage(img) {
  const copy = new Uint8ClampedArray(img.data);
  return call({ type: "image", width: img.width, height: img.height, buffer: copy.buffer }, [copy.buffer]);
}

let latest = 0;
/** Trace the current image; resolves null if a newer trace replaced this one. */
export async function traceImage(options) {
  const ticket = ++latest;
  const result = await call({ type: "trace", options });
  return ticket === latest ? result : null;
}
