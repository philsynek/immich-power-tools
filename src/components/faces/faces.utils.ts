import React, { useEffect, useRef, useState } from "react";

import type {
  IFace, IFaceDateMode, IFaceGroup, IFaceGroupInfo, IFaceLogRow, IFaceOrigin, IFaceSortDir, IFacesNamedPerson, IFacesPersonRow,
} from "@/types/faces";

export type PersonRow = IFacesPersonRow;
export type Face = IFace;
export type GroupInfo = IFaceGroupInfo;
export type GroupRow = IFaceGroup;
export type LogRow = IFaceLogRow;
export type NamedPerson = IFacesNamedPerson;
export type DateMode = IFaceDateMode;
export type Origin = IFaceOrigin;
export type SortDir = IFaceSortDir;
export type Mode = "single" | "groups";
export const DATE_LABEL: Record<DateMode, string> = {
  all: "All photos",
  hidePre: "Hide photos before birth (1970 / Jan 1 stay)",
  onlyPre: "Only photos before birth (incl. 1970 / Jan 1)",
};
export const ORIGIN_LABEL: Record<Origin, string> = {
  loose: "Loose faces + faces excluded from groups",
  group: "Only faces from groups",
  all: "All faces",
};
export interface SortState { key: string; dir: SortDir }
/** Sort options per mode with their natural default direction. */
export const SORTS: Record<Mode, { key: string; label: string; dir: SortDir }[]> = {
  single: [
    { key: "distance", label: "Similarity", dir: "asc" },
    { key: "date", label: "Capture date", dir: "desc" },
    { key: "size", label: "Face size", dir: "desc" },
    { key: "margin", label: "Gap to runner-up", dir: "asc" },
  ],
  groups: [
    { key: "size", label: "Group size", dir: "desc" },
    { key: "share", label: "Clear majority", dir: "desc" },
    { key: "best", label: "Closest face", dir: "asc" },
  ],
};
/** Short hint what the current direction means. */
export const sortHint = (key: string, dir: SortDir) => ({
  distance: dir === "asc" ? "most similar first" : "least similar first",
  date: dir === "desc" ? "newest first" : "oldest first",
  size: dir === "desc" ? "largest faces first" : "smallest faces first",
  margin: dir === "asc" ? "closest calls first" : "clearest first",
  share: dir === "desc" ? "clearest first" : "most mixed first",
  best: dir === "asc" ? "closest face first" : "farthest face first",
} as Record<string, string>)[key] ?? "";
export const loadSort = (mode: Mode): SortState => {
  const fallback = { key: SORTS[mode][0].key, dir: SORTS[mode][0].dir };
  try {
    const v = JSON.parse(localStorage.getItem(`unnamedFaces.sort.${mode}`) || "null");
    return v && SORTS[mode].some((o) => o.key === v.key) && (v.dir === "asc" || v.dir === "desc") ? v : fallback;
  } catch { return fallback; }
};
export const saveSort = (mode: Mode, v: SortState) => { try { localStorage.setItem(`unnamedFaces.sort.${mode}`, JSON.stringify(v)); } catch { /* ignore */ } };

export const SIZES = { S: 160, M: 220, L: 300 } as const;
export type Size = keyof typeof SIZES;
export const PAGE = 300;
export const GROUP_PAGE = 100;

export const ageAt = (birth: string | null, captured: string | null) => {
  if (!birth || !captured) return null;
  return (new Date(captured).getTime() - new Date(birth).getTime()) / (365.25 * 24 * 3600 * 1000);
};
export const fmtD = (d: number | null | undefined) => (d == null ? "–" : d.toFixed(2));
export const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "no date");
export const breakdownText = (b: { personId: string; n: number }[] | undefined, names: Record<string, string>) =>
  b?.length ? b.map((x) => `${x.n} ${names[x.personId] ?? "?"}`).join(" · ") : "no open suggestions";

/** Viewport width (updates on resize). Mobile layout below 768 px. */
export function useViewportWidth() {
  const [w, setW] = useState(1200);
  useEffect(() => {
    const f = () => setW(window.innerWidth);
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return w;
}
/** Width of an element, kept up to date (ResizeObserver). Callback ref, so it follows remounts. */
export function useElementWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w] as const;
}
/** Tile edge length so that `cols` tiles fill a container of width w (gap 8, tile padding/border 10). */
export const tileFor = (w: number, cols: number) => Math.max(80, Math.floor((w - 8 * (cols - 1)) / cols) - 10);

/** Horizontal swipe on touch devices. */
export function useSwipe(onLeft: () => void, onRight: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; },
    onTouchEnd: (e: React.TouchEvent) => {
      if (!start.current) return;
      const dx = e.changedTouches[0].clientX - start.current.x, dy = e.changedTouches[0].clientY - start.current.y;
      start.current = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) (dx < 0 ? onLeft : onRight)();
    },
  };
}
