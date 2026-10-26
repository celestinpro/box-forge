import { getOC } from "replicad";

// Small helpers shared by all models.

/** Clamp a value between lo and hi. */
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Fillet that never takes the whole build down. OpenCascade refuses fillets
 * that are too large for the geometry; in that case we keep the sharp edge
 * and record a warning instead of failing (the bug that broke the original
 * site for narrow cards).
 */
export function safeFillet(shape, radius, filter, warnings, label) {
  if (!(radius > 0.05)) return shape;
  try {
    const out = shape.fillet(radius, filter);
    // OpenCascade sometimes "succeeds" with a broken solid; treat that as a failure.
    if (isValidSolid(out)) return out;
    out.delete?.();
  } catch (e) {
    // fall through
  }
  if (warnings && label) warnings.push(`${label}: kept sharp (rounding didn't fit)`);
  return shape;
}

/** True when OpenCascade considers the shape a valid, closed solid. */
export function isValidSolid(shape) {
  const oc = getOC();
  const check = new oc.BRepCheck_Analyzer(shape.wrapped, true, false, false);
  const ok = check.IsValid();
  check.delete();
  return ok;
}

/** Coerce a value to a finite number, falling back to a default. */
export function num(v, fallback) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

/** Throw a readable error when a parameter is outside a sane range. */
export function requireRange(name, v, lo, hi) {
  if (!(v >= lo && v <= hi)) {
    throw new Error(`${name} must be between ${lo} and ${hi} mm (got ${v}).`);
  }
}

/**
 * Edge filter: edges lying in the horizontal plane at height z. Uses a thin
 * bounding box instead of inPlane(), which logs noisy errors for curved edges.
 */
export const atZ = (z) => (e) => e.inBox([-1e4, -1e4, z - 0.05], [1e4, 1e4, z + 0.05]);
