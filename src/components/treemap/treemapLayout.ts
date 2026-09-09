/**
 * Squarified treemap layout (Bruls, Huizing & van Wijk, 2000).
 * Pure function: given weighted items and a target rectangle, returns
 * child rectangles whose areas are proportional to each item's value and
 * whose aspect ratios stay close to square wherever possible.
 */

export interface TreemapRect<T> {
  x: number;
  y: number;
  w: number;
  h: number;
  node: T;
  value: number;
}

interface WeightedItem<T> {
  value: number;
  node: T;
}

interface ScaledItem<T> extends WeightedItem<T> {
  area: number;
}

function worstAspectRatio(row: ScaledItem<unknown>[], length: number): number {
  const sum = row.reduce((s, r) => s + r.area, 0);
  if (sum <= 0 || length <= 0) return Infinity;
  const rowMax = Math.max(...row.map((r) => r.area));
  const rowMin = Math.min(...row.map((r) => r.area));
  const s2 = sum * sum;
  const l2 = length * length;
  return Math.max((l2 * rowMax) / s2, s2 / (l2 * rowMin));
}

export function squarify<T>(items: WeightedItem<T>[], x: number, y: number, w: number, h: number): TreemapRect<T>[] {
  const positive = items.filter((i) => i.value > 0);
  if (positive.length === 0 || w <= 0 || h <= 0) return [];

  const total = positive.reduce((s, i) => s + i.value, 0);
  const area = w * h;
  const scaled: ScaledItem<T>[] = positive.map((i) => ({ ...i, area: (i.value / total) * area }));

  const result: TreemapRect<T>[] = [];

  function layoutRow(row: ScaledItem<T>[], rx: number, ry: number, rw: number, rh: number, horizontal: boolean) {
    const rowSum = row.reduce((s, r) => s + r.area, 0);
    if (horizontal) {
      const rowHeight = rw > 0 ? rowSum / rw : 0;
      let cx = rx;
      for (const item of row) {
        const itemWidth = rowHeight > 0 ? item.area / rowHeight : 0;
        result.push({ x: cx, y: ry, w: itemWidth, h: rowHeight, node: item.node, value: item.value });
        cx += itemWidth;
      }
    } else {
      const rowWidth = rh > 0 ? rowSum / rh : 0;
      let cy = ry;
      for (const item of row) {
        const itemHeight = rowWidth > 0 ? item.area / rowWidth : 0;
        result.push({ x: rx, y: cy, w: rowWidth, h: itemHeight, node: item.node, value: item.value });
        cy += itemHeight;
      }
    }
  }

  function recurse(remaining: ScaledItem<T>[], rx: number, ry: number, rw: number, rh: number) {
    if (remaining.length === 0 || rw <= 0 || rh <= 0) return;
    if (remaining.length === 1) {
      result.push({ x: rx, y: ry, w: rw, h: rh, node: remaining[0].node, value: remaining[0].value });
      return;
    }
    const shortSide = Math.min(rw, rh);
    let row: ScaledItem<T>[] = [remaining[0]];
    let i = 1;
    while (i < remaining.length) {
      const withNext = [...row, remaining[i]];
      if (worstAspectRatio(withNext, shortSide) <= worstAspectRatio(row, shortSide)) {
        row = withNext;
        i++;
      } else {
        break;
      }
    }
    const horizontal = rw >= rh;
    const rowAreaSum = row.reduce((s, r) => s + r.area, 0);
    if (horizontal) {
      const rowHeight = rw > 0 ? rowAreaSum / rw : 0;
      layoutRow(row, rx, ry, rw, rowHeight, true);
      recurse(remaining.slice(i), rx, ry + rowHeight, rw, rh - rowHeight);
    } else {
      const rowWidth = rh > 0 ? rowAreaSum / rh : 0;
      layoutRow(row, rx, ry, rowWidth, rh, false);
      recurse(remaining.slice(i), rx + rowWidth, ry, rw - rowWidth, rh);
    }
  }

  recurse(scaled, x, y, w, h);
  return result;
}
