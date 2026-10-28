// Token tray sections: the tray's inside split into compartments by a tree
// of splits, so any compartment can be split again or resized.
//
//   leaf:  {}
//   split: { dir: "x" | "y", sizes: [share, …], kids: [node, …] }
//
// "x" puts the kids side by side (left → right), "y" front → back. `sizes`
// are shares of the free length (the length left after the walls between
// the kids), so they add up to 1 and keep their proportions when the tray is
// resized. A path is the list of kid indices from the root to a node.
//
// Plain JS (no CAD): the editor and the 3D model share it.

export const MIN_SECTION = 4; // mm, smallest compartment side

const isSplit = (n) => n && (n.dir === "x" || n.dir === "y") && Array.isArray(n.kids) && n.kids.length > 0;

/** Even grid: `columns` side by side, each split into `rows` front to back. */
export function gridTree(columns, rows) {
  const even = (n) => Array.from({ length: n }, () => 1 / n);
  const column = () => (rows > 1 ? { dir: "y", sizes: even(rows), kids: Array.from({ length: rows }, () => ({})) } : {});
  if (columns <= 1) return column();
  return { dir: "x", sizes: even(columns), kids: Array.from({ length: columns }, column) };
}

/** A clean copy: shares normalised, single-kid splits collapsed, bad input dropped. */
export function normalise(node, depth = 0) {
  if (!isSplit(node) || depth > 30) return {};
  let kids = node.kids.map((k) => normalise(k, depth + 1));
  let sizes = kids.map((_, i) => Math.max(0, Number(node.sizes?.[i]) || 0));
  if (kids.length === 1) return kids[0];
  const total = sizes.reduce((a, b) => a + b, 0);
  sizes = total > 0 ? sizes.map((s) => s / total) : kids.map(() => 1 / kids.length);
  return { dir: node.dir, sizes, kids };
}

/** Number of compartments. */
export const countLeaves = (node) => (isSplit(node) ? node.kids.reduce((a, k) => a + countLeaves(k), 0) : 1);

/**
 * Lay the tree out in a rectangle { x, y, w, h } (the tray's inside).
 * Returns cells [{ path, x, y, w, h }] and walls [{ path, index, dir, x, y, w, h,
 * free, start }] where `path` + `index` name the wall between kids index and
 * index+1 of that split, `free` is that split's free length and `start` its
 * starting coordinate along `dir`.
 */
export function layoutSections(tree, rect, wall) {
  const cells = [];
  const walls = [];
  const walk = (node, r, path) => {
    if (!isSplit(node)) {
      cells.push({ path, ...r });
      return;
    }
    const along = node.dir === "x" ? r.w : r.h;
    const free = along - (node.kids.length - 1) * wall;
    let pos = node.dir === "x" ? r.x : r.y;
    const start = pos;
    node.kids.forEach((kid, i) => {
      const len = node.sizes[i] * free;
      const kr = node.dir === "x" ? { x: pos, y: r.y, w: len, h: r.h } : { x: r.x, y: pos, w: r.w, h: len };
      walk(kid, kr, [...path, i]);
      pos += len;
      if (i < node.kids.length - 1) {
        walls.push(node.dir === "x" ? { path, index: i, dir: "x", x: pos, y: r.y, w: wall, h: r.h, free, start } : { path, index: i, dir: "y", x: r.x, y: pos, w: r.w, h: wall, free, start });
        pos += wall;
      }
    });
  };
  walk(tree, rect, []);
  return { cells, walls };
}

/** Smallest length a subtree can have along `dir` while every cell stays ≥ MIN_SECTION. */
export function minLength(node, dir, wall) {
  if (!isSplit(node)) return MIN_SECTION;
  const mins = node.kids.map((k) => minLength(k, dir, wall));
  return node.dir === dir ? mins.reduce((a, b) => a + b, 0) + (node.kids.length - 1) * wall : Math.max(...mins);
}

export const nodeAt = (tree, path) => path.reduce((n, i) => (isSplit(n) ? n.kids[i] : n), tree);

/** Replace the node at `path` (returns a new tree). */
function replaceAt(tree, path, fn) {
  if (!path.length) return fn(tree);
  const [i, ...rest] = path;
  const kids = tree.kids.slice();
  kids[i] = replaceAt(kids[i], rest, fn);
  return { ...tree, sizes: tree.sizes.slice(), kids };
}

/**
 * Split the compartment at `path` in two along `dir` ("x" = side by side).
 * If its parent already splits that way, the new compartment joins the
 * parent as a sibling (so three-in-a-row stays one row).
 */
export function splitSection(tree, path, dir) {
  if (path.length) {
    const parentPath = path.slice(0, -1);
    const parent = nodeAt(tree, parentPath);
    const i = path.at(-1);
    if (parent.dir === dir && !isSplit(parent.kids[i])) {
      return replaceAt(tree, parentPath, (p) => {
        const half = p.sizes[i] / 2;
        const sizes = p.sizes.slice();
        sizes.splice(i, 1, half, half);
        const kids = p.kids.slice();
        kids.splice(i + 1, 0, {});
        return { ...p, sizes, kids };
      });
    }
  }
  return replaceAt(tree, path, (leaf) => ({ dir, sizes: [0.5, 0.5], kids: [leaf, {}] }));
}

/** Remove the compartment at `path`; its space goes to its neighbour. */
export function removeSection(tree, path) {
  if (!path.length) return tree; // the last compartment stays
  const parentPath = path.slice(0, -1);
  const i = path.at(-1);
  return normalise(
    replaceAt(tree, parentPath, (p) => {
      const sizes = p.sizes.slice();
      const kids = p.kids.slice();
      const into = i > 0 ? i - 1 : 1;
      sizes[into] += sizes[i];
      sizes.splice(i, 1);
      kids.splice(i, 1);
      return kids.length === 1 ? kids[0] : { ...p, sizes, kids };
    })
  );
}

/** Make the compartment at `path` and its siblings equal. */
export function evenOut(tree, path) {
  if (!path.length) return tree;
  return replaceAt(tree, path.slice(0, -1), (p) => ({ ...p, sizes: p.kids.map(() => 1 / p.kids.length) }));
}

/**
 * Move the wall between kids `index` and `index + 1` of the split at `path`
 * by `delta` mm (+ = right / back). Both sides keep at least their minimum.
 */
export function moveWall(tree, path, index, delta, free, wall) {
  return replaceAt(tree, path, (p) => {
    const a = p.sizes[index] * free;
    const b = p.sizes[index + 1] * free;
    const minA = minLength(p.kids[index], p.dir, wall);
    const minB = minLength(p.kids[index + 1], p.dir, wall);
    const d = Math.max(minA - a, Math.min(b - minB, delta));
    const sizes = p.sizes.slice();
    sizes[index] = (a + d) / free;
    sizes[index + 1] = (b - d) / free;
    return { ...p, sizes };
  });
}

/**
 * Set the length (mm) of the compartment at `path` along `dir`, by changing
 * its share in the nearest split that runs that way. The neighbour after it
 * (or before, for the last one) gives or takes the difference.
 * Returns the new tree, or the old one when there's no such split.
 */
export function setSectionLength(tree, path, dir, mm, rect, wall) {
  for (let depth = path.length - 1; depth >= 0; depth--) {
    const splitPath = path.slice(0, depth);
    const split = nodeAt(tree, splitPath);
    if (split.dir !== dir) continue;
    const i = path[depth];
    const { walls } = layoutSections(tree, rect, wall);
    const key = splitPath.join(".");
    const w = walls.find((x) => x.path.join(".") === key);
    if (!w) return tree;
    const cur = split.sizes[i] * w.free;
    // Grow by moving the wall after it, or the one before for the last kid.
    return i < split.kids.length - 1 ? moveWall(tree, splitPath, i, mm - cur, w.free, wall) : moveWall(tree, splitPath, i - 1, cur - mm, w.free, wall);
  }
  return tree;
}
