// Web worker: runs OpenCascade (via replicad) off the main thread so the page
// stays responsive while a model builds.
import opencascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { setOC, exportSTEP } from "replicad";
import { MODELS } from "../models/index.js";

// OpenCascade logs "failed to compute a normal" while working with curved
// edges. It's harmless, so keep it out of the console.
const consoleError = console.error.bind(console);
console.error = (...args) => {
  if (!/compute a normal/.test(String(args[0]))) consoleError(...args);
};

const ready = (async () => {
  const OC = await opencascade({ locateFile: () => wasmUrl });
  setOC(OC);
})();

// Parts of the most recent successful build, kept for export.
let lastParts = [];
let lastName = "box";

function meshPart({ name, shape }) {
  const m = shape.mesh({ tolerance: 0.05, angularTolerance: 0.25 });
  const e = shape.meshEdges({ tolerance: 0.05, angularTolerance: 0.25 });
  const bb = shape.boundingBox.bounds;
  return {
    name,
    vertices: new Float32Array(m.vertices),
    normals: new Float32Array(m.normals),
    triangles: new Uint32Array(m.triangles),
    edges: new Float32Array(e.lines),
    bounds: bb,
  };
}

async function handle(msg) {
  await ready;
  if (msg.type === "build") {
    const model = MODELS[msg.model];
    if (!model) throw new Error(`Unknown model "${msg.model}"`);
    const t0 = performance.now();
    const { parts, layout, warnings } = model.build(msg.params);
    lastParts.forEach((p) => p.shape.delete?.());
    lastParts = parts;
    lastName = msg.model;
    const meshes = parts.map(meshPart);
    return {
      meshes,
      summary: model.describe(layout),
      warnings,
      ms: Math.round(performance.now() - t0),
      transfer: meshes.flatMap((m) => [m.vertices.buffer, m.normals.buffer, m.triangles.buffer, m.edges.buffer]),
    };
  }
  if (msg.type === "export") {
    if (!lastParts.length) throw new Error("Nothing to export yet.");
    const parts = msg.part === "all" ? lastParts : lastParts.filter((p) => p.name === msg.part);
    if (!parts.length) throw new Error(`No part named "${msg.part}".`);
    let blob;
    if (msg.format === "stl") {
      blob = parts[0].shape.blobSTL({ binary: true, tolerance: 0.02, angularTolerance: 0.1 });
    } else if (msg.format === "step") {
      blob = exportSTEP(parts.map((p) => ({ shape: p.shape, name: p.name })));
    } else {
      throw new Error(`Unknown format "${msg.format}"`);
    }
    const suffix = msg.part === "all" ? "" : `-${parts[0].name}`;
    return { blob, filename: `${lastName}${suffix}.${msg.format}` };
  }
  throw new Error(`Unknown message type "${msg.type}"`);
}

self.onmessage = async ({ data }) => {
  try {
    const { transfer = [], ...result } = await handle(data);
    self.postMessage({ id: data.id, ok: true, result }, transfer);
  } catch (err) {
    const message = typeof err === "number" ? `OpenCascade error ${err}` : err?.message || String(err);
    self.postMessage({ id: data.id, ok: false, error: message });
  }
};
