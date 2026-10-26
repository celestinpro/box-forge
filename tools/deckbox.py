#!/usr/bin/env python3
"""
Multi-pocket deck box generator (tray + slip-over lid).

Each pocket can have its own card size and deck thickness, so you can put
two (or more) differently sized decks side by side in one box.

Dimensions follow the same conventions as deckinabox.sgenoud.com "Quick Draw":
  pocket = card + card_tolerance (in both X and Y)
  walls  = wall_thickness, including the divider between pockets
  lid    = slips over the whole tray with lid_tolerance clearance

Usage:
  python deckbox.py --pocket 45x14x20 --pocket 50x18x15 --out out/
      pocket format: CARD_HEIGHTxCARD_WIDTHxDECK_HEIGHT  (mm)
      optional 4th value = finger slot width, e.g. 45x14x20x8

  Other options: --wall 1.8 --card-tol 2 --lid-tol 0.6 --fillet 1
                 --no-lid  --align center|front
"""
import argparse
import os
from dataclasses import dataclass

import cadquery as cq


@dataclass
class Pocket:
    card_h: float          # long side of the card (Y)
    card_w: float          # short side of the card (X)
    deck: float            # thickness of the stack (Z)
    finger: float = 12.0   # requested finger-slot width; clamped to fit

    @classmethod
    def parse(cls, s: str) -> "Pocket":
        vals = [float(v) for v in s.lower().split("x")]
        if len(vals) not in (3, 4):
            raise ValueError(f"pocket '{s}' must be HxWxDECK or HxWxDECKxFINGER")
        return cls(*vals)


@dataclass
class Settings:
    wall: float = 1.8
    card_tol: float = 2.0
    lid_tol: float = 0.6
    fillet: float = 1.0      # inner pocket corner radius
    align: str = "center"    # how shorter pockets sit in Y: center | front


def _layout(pockets, s: Settings):
    px = [p.card_w + s.card_tol for p in pockets]
    py = [p.card_h + s.card_tol for p in pockets]
    total_x = sum(px) + (len(pockets) + 1) * s.wall
    total_y = max(py) + 2 * s.wall
    total_z = max(p.deck for p in pockets) + s.wall
    return px, py, total_x, total_y, total_z


def _safe_fillet(wp, selector, r):
    """Fillet if possible; skip quietly when the radius is too small or fails."""
    if r <= 0.05:
        return wp
    try:
        return wp.edges(selector).fillet(r)
    except Exception:
        return wp


def build_tray(pockets, s: Settings):
    px, py, tx, ty, tz = _layout(pockets, s)
    outer_r = s.fillet + s.wall

    tray = cq.Workplane("XY").box(tx, ty, tz, centered=(True, True, False))
    tray = _safe_fillet(tray, "|Z", outer_r)

    x = -tx / 2 + s.wall
    for p, cx, cy in zip(pockets, px, py):
        xc = x + cx / 2
        if s.align == "front":
            yc = -ty / 2 + s.wall + cy / 2
        else:
            yc = 0.0
        floor_z = tz - p.deck  # every deck sits flush with the top rim

        # Pocket. Corner radius must stay below half the pocket width.
        r = min(s.fillet, cx / 2 - 0.2, cy / 2 - 0.2)
        pocket = cq.Workplane("XY").box(cx, cy, p.deck + 1, centered=(True, True, False))
        pocket = _safe_fillet(pocket, "|Z", r)
        pocket = _safe_fillet(pocket, "<Z", min(s.wall / 2, r if r > 0.1 else s.wall / 2))
        tray = tray.cut(pocket.translate((xc, yc, floor_z)))

        # Finger slots on both short ends. Width scales down for narrow cards,
        # which is exactly what the website fails to do.
        slot_w = max(4.0, min(p.finger, cx * 0.6, cx - 2 * r - 1.0))
        slot_bottom = floor_z + min(2.0, p.deck / 4)
        slot_h = tz - slot_bottom + 1
        reach = (ty - cy) / 2 + 1.0  # from the pocket edge through the outer wall
        for sign in (1, -1):
            y_edge = yc + sign * cy / 2
            # U-shaped slot: rectangle + half-circle bottom, extruded along Y.
            u = (
                cq.Workplane("XZ", origin=(0, y_edge - sign * 0.5, 0))
                .moveTo(xc - slot_w / 2, slot_bottom + slot_w / 2)
                .lineTo(xc - slot_w / 2, tz + 1)
                .lineTo(xc + slot_w / 2, tz + 1)
                .lineTo(xc + slot_w / 2, slot_bottom + slot_w / 2)
                .threePointArc((xc, slot_bottom), (xc - slot_w / 2, slot_bottom + slot_w / 2))
                .close()
            )
            # Workplane "XZ" normal is -Y, so extrude direction depends on sign.
            depth = reach + 0.5
            u = u.extrude(depth if sign == -1 else -depth)
            tray = tray.cut(u)

        x += cx + s.wall

    # Soften the top rim a little.
    tray = _safe_fillet(tray, ">Z", min(0.4, s.wall / 4))
    return tray


def build_lid(pockets, s: Settings):
    _, _, tx, ty, tz = _layout(pockets, s)
    outer_r = s.fillet + s.wall
    add = s.lid_tol / 2

    in_x, in_y, in_z = tx + 2 * add, ty + 2 * add, tz + add
    in_r = outer_r + add
    out_x, out_y, out_z = in_x + 2 * s.wall, in_y + 2 * s.wall, in_z + s.wall
    out_r = in_r + s.wall

    lid = cq.Workplane("XY").box(out_x, out_y, out_z, centered=(True, True, False))
    lid = _safe_fillet(lid, "|Z", out_r)
    lid = _safe_fillet(lid, ">Z", s.wall / 2)
    cavity = cq.Workplane("XY").box(in_x, in_y, in_z, centered=(True, True, False))
    cavity = _safe_fillet(cavity, "|Z", in_r)
    lid = lid.cut(cavity)

    # Thumb notches on the open rim, centred on the two finger-slot ends, to pull the lid off.
    notch_r = min(6.0, in_z / 2)
    notch = cq.Workplane("XZ").circle(notch_r).extrude(out_y / 2 + 1, both=True)
    lid = lid.cut(notch)
    return lid


def describe(pockets, s: Settings):
    px, py, tx, ty, tz = _layout(pockets, s)
    add = s.lid_tol / 2
    lines = [
        f"tray outer: {tx:.1f} x {ty:.1f} x {tz:.1f} mm",
        f"lid  outer: {tx + 2*add + 2*s.wall:.1f} x {ty + 2*add + 2*s.wall:.1f} x {tz + add + s.wall:.1f} mm",
    ]
    for i, (p, cx, cy) in enumerate(zip(pockets, px, py), 1):
        r = min(s.fillet, cx / 2 - 0.2, cy / 2 - 0.2)
        slot = max(4.0, min(p.finger, cx * 0.6, cx - 2 * r - 1.0))
        lines.append(
            f"pocket {i}: card {p.card_h:g}x{p.card_w:g}, deck {p.deck:g} -> "
            f"cavity {cy:.1f} x {cx:.1f} x {p.deck:.1f} mm, finger slot {slot:.1f} mm"
        )
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pocket", action="append", required=True)
    ap.add_argument("--wall", type=float, default=1.8)
    ap.add_argument("--card-tol", type=float, default=2.0)
    ap.add_argument("--lid-tol", type=float, default=0.6)
    ap.add_argument("--fillet", type=float, default=1.0)
    ap.add_argument("--align", choices=["center", "front"], default="center")
    ap.add_argument("--no-lid", action="store_true")
    ap.add_argument("--out", default="out")
    ap.add_argument("--name", default="deckbox")
    a = ap.parse_args()

    pockets = [Pocket.parse(p) for p in a.pocket]
    s = Settings(a.wall, a.card_tol, a.lid_tol, a.fillet, a.align)
    os.makedirs(a.out, exist_ok=True)

    tray = build_tray(pockets, s)
    cq.exporters.export(tray, os.path.join(a.out, f"{a.name}-tray.stl"), tolerance=0.05, angularTolerance=0.1)
    cq.exporters.export(tray, os.path.join(a.out, f"{a.name}-tray.step"))
    if not a.no_lid:
        lid = build_lid(pockets, s)
        cq.exporters.export(lid, os.path.join(a.out, f"{a.name}-lid.stl"), tolerance=0.05, angularTolerance=0.1)
        cq.exporters.export(lid, os.path.join(a.out, f"{a.name}-lid.step"))
    print(describe(pockets, s))


if __name__ == "__main__":
    main()
