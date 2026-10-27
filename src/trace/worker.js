// Web worker for photo tracing, so the page stays responsive. Keeps the
// current image and its (expensive) difference map between traces.
import { prepare, trace } from "./trace.js";

let image = null;
let prep = null;

function handle(msg) {
  if (msg.type === "image") {
    image = { width: msg.width, height: msg.height, data: new Uint8ClampedArray(msg.buffer) };
    prep = null;
    return { ok: true };
  }
  if (msg.type === "trace") {
    if (!image) throw new Error("No photo loaded yet.");
    const ignoreShadows = msg.options.ignoreShadows !== false;
    if (!prep || prep.ignoreShadows !== ignoreShadows) prep = prepare(image, { ignoreShadows });
    const t0 = performance.now();
    const result = trace(prep, { ...msg.options, includeEdge: new Set(msg.options.includeEdge || []) });
    result.ms = Math.round(performance.now() - t0);
    return result;
  }
  throw new Error(`Unknown message "${msg.type}"`);
}

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ id: data.id, ok: true, result: handle(data) });
  } catch (err) {
    self.postMessage({ id: data.id, ok: false, error: err?.message || String(err) });
  }
};
