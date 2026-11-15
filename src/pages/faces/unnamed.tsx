import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import PageLayout from "@/components/layouts/PageLayout";
import Header from "@/components/shared/Header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfig } from "@/contexts/ConfigContext";
import { AvatarFallback, AvatarImage, AvatarRoot } from "@/components/ui/avatar";
import { PERSON_THUBNAIL_PATH } from "@/config/routes";
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, EyeOff, Maximize2, PenLine, Trash2, UserPlus, Users, X } from "lucide-react";

interface PersonRow { personId: string; name: string; birthDate: string | null; total: number; loose: number; groups: number }
interface Face {
  faceId: string; assetId: string; distance: number | null; excluded?: boolean | number;
  suggestedPersonId: string | null; suggestedName: string | null;
  secondPersonId: string | null; secondName: string | null; secondDistance: number | null;
  currentPersonId: string | null; capturedAt: string | null; w: number; h: number; x1: number; y1: number; x2: number; y2: number;
}
interface GroupInfo { size: number; breakdown: { personId: string; n: number }[] }
interface GroupRow {
  clusterId: string; size: number; majority: number; withSuggestion: number; excluded: number; noSuggestion: number;
  breakdown: { personId: string; n: number }[];
  rep: { faceId: string; assetId: string; distance: number; capturedAt: string | null; w: number; h: number; x1: number; y1: number; x2: number; y2: number } | null;
}
interface LogRow {
  id: number; ts: string; action: string; faceId: string; assetId: string; fromName: string | null; toName: string | null;
  distance: number | null; ok: number; error: string | null; undoneAt: string | null;
}
type DateMode = "all" | "hidePre" | "onlyPre";
type Origin = "all" | "group" | "loose";
type Mode = "single" | "groups";
const DATE_LABEL: Record<DateMode, string> = {
  all: "All photos",
  hidePre: "Hide photos before birth (1970 / Jan 1 stay)",
  onlyPre: "Only photos before birth (incl. 1970 / Jan 1)",
};
const ORIGIN_LABEL: Record<Origin, string> = {
  loose: "Loose faces + faces excluded from groups",
  group: "Only faces from groups",
  all: "All faces",
};
type SortDir = "asc" | "desc";
interface SortState { key: string; dir: SortDir }
/** Sort options per mode with their natural default direction. */
const SORTS: Record<Mode, { key: string; label: string; dir: SortDir }[]> = {
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
const sortHint = (key: string, dir: SortDir) => ({
  distance: dir === "asc" ? "most similar first" : "least similar first",
  date: dir === "desc" ? "newest first" : "oldest first",
  size: dir === "desc" ? "largest faces first" : "smallest faces first",
  margin: dir === "asc" ? "closest calls first" : "clearest first",
  share: dir === "desc" ? "clearest first" : "most mixed first",
  best: dir === "asc" ? "closest face first" : "farthest face first",
} as Record<string, string>)[key] ?? "";
const loadSort = (mode: Mode): SortState => {
  const fallback = { key: SORTS[mode][0].key, dir: SORTS[mode][0].dir };
  try {
    const v = JSON.parse(localStorage.getItem(`unnamedFaces.sort.${mode}`) || "null");
    return v && SORTS[mode].some((o) => o.key === v.key) && (v.dir === "asc" || v.dir === "desc") ? v : fallback;
  } catch { return fallback; }
};
const saveSort = (mode: Mode, v: SortState) => { try { localStorage.setItem(`unnamedFaces.sort.${mode}`, JSON.stringify(v)); } catch { /* ignore */ } };

/** Sort dropdown + direction toggle. */
function SortControl({ mode, value, onChange }: { mode: Mode; value: SortState; onChange: (v: SortState) => void }) {
  return (
    <div className="flex items-center gap-1">
      <select className="rounded-md border bg-background p-2 text-sm" value={value.key} title="Sort by"
        onChange={(e) => { const o = SORTS[mode].find((x) => x.key === e.target.value)!; onChange({ key: o.key, dir: o.dir }); }}>
        {SORTS[mode].map((o) => <option key={o.key} value={o.key}>Sort: {o.label}</option>)}
      </select>
      <Button size="sm" variant="outline" className="h-9" title={`Reverse (${sortHint(value.key, value.dir)})`}
        onClick={() => onChange({ ...value, dir: value.dir === "asc" ? "desc" : "asc" })}>
        {value.dir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
      </Button>
    </div>
  );
}

const SIZES = { S: 160, M: 220, L: 300 } as const;
type Size = keyof typeof SIZES;
const PAGE = 300;
const GROUP_PAGE = 100;

const ageAt = (birth: string | null, captured: string | null) => {
  if (!birth || !captured) return null;
  return (new Date(captured).getTime() - new Date(birth).getTime()) / (365.25 * 24 * 3600 * 1000);
};
const fmtD = (d: number | null | undefined) => (d == null ? "–" : d.toFixed(2));
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "no date");
const breakdownText = (b: { personId: string; n: number }[] | undefined, names: Record<string, string>) =>
  b?.length ? b.map((x) => `${x.n} ${names[x.personId] ?? "?"}`).join(" · ") : "no open suggestions";

/** Viewport width (updates on resize). Mobile layout below 768 px. */
function useViewportWidth() {
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
function useElementWidth<T extends HTMLElement>() {
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
const tileFor = (w: number, cols: number) => Math.max(80, Math.floor((w - 8 * (cols - 1)) / cols) - 10);

/** Horizontal swipe on touch devices. */
function useSwipe(onLeft: () => void, onRight: () => void) {
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

/** Face crop as CSS background (from Immich preview + bounding box). */
function FaceCrop({ assetId, box, size, onClick, onLongPress, title, className, children }: {
  assetId: string; box: { w: number; h: number; x1: number; y1: number; x2: number; y2: number }; size: number;
  onClick?: (e: React.MouseEvent) => void; onLongPress?: () => void; title?: string; className?: string; children?: React.ReactNode;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
  const s = Math.max(box.x2 - box.x1, box.y2 - box.y1) * 1.6 || 1;
  const bgW = (box.w / s) * size, bgH = (box.h / s) * size;
  const left = -((cx - s / 2) / box.w) * bgW, top = -((cy - s / 2) / box.h) * bgH;
  return (
    <div title={title} className={`relative select-none rounded ${className ?? ""}`}
      onClick={(e) => { if (fired.current) { fired.current = false; return; } onClick?.(e); }}
      onTouchStart={() => { if (!onLongPress) return; fired.current = false; cancel(); timer.current = setTimeout(() => { fired.current = true; onLongPress(); }, 500); }}
      onTouchEnd={cancel} onTouchMove={cancel}
      onContextMenu={(e) => { if (onLongPress) e.preventDefault(); }}
      style={{ WebkitTouchCallout: "none",
      width: size, height: size, backgroundImage: `url(/api/immich-proxy/asset/thumbnail/${assetId}?size=preview)`,
      backgroundSize: `${bgW}px ${bgH}px`, backgroundPosition: `${left}px ${top}px`, backgroundRepeat: "no-repeat",
    }}>{children}</div>
  );
}

/** Small "delete" button with a second confirming click. */
function DeleteButton({ onDelete, big }: { onDelete: () => void; big?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  return (
    <button onClick={() => (armed ? onDelete() : setArmed(true))} title="No face: delete this detection in Immich (the photo stays)"
      className={`flex items-center gap-1 rounded border p-1.5 md:p-1 ${big ? "px-2" : ""} ${armed ? "border-red-600 bg-red-600 text-white" : "hover:bg-muted"}`}>
      <Trash2 className="h-3.5 w-3.5" />{armed && <span>Sure?</span>}
    </button>
  );
}

/** Person face (same thumbnail route and avatar component as the Merge dialog); initial as fallback. */
function PersonAvatar({ id, name, className }: { id: string; name?: string; className?: string }) {
  return (
    <AvatarRoot className={className ?? "h-7 w-7"}>
      <AvatarImage src={PERSON_THUBNAIL_PATH(id)} alt={name ?? ""} className="object-cover" />
      <AvatarFallback className="text-xs">{(name ?? "?").slice(0, 1).toUpperCase()}</AvatarFallback>
    </AvatarRoot>
  );
}

/** Person dropdown for the header: face, name and count; searchable. */
function PersonSelect({ people, value, onChange, countLabel }: {
  people: PersonRow[]; value: string; onChange: (id: string) => void; countLabel: (p: PersonRow) => string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const cur = people.find((p) => p.personId === value);
  const list = people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const choose = (id: string) => { onChange(id); setOpen(false); setQ(""); };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-sm hover:bg-muted">
        {cur ? <PersonAvatar id={cur.personId} name={cur.name} className="h-6 w-6" /> : null}
        <span className="max-w-[10rem] truncate">{cur?.name ?? "Select person"}</span>
        {cur && <span className="text-xs text-muted-foreground">{countLabel(cur)}</span>}
        <ChevronDown className="h-4 w-4 opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 flex max-h-[60vh] w-72 flex-col gap-1 rounded-md border bg-background p-2 shadow-lg">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people"
              onKeyDown={(e) => { if (e.key === "Enter" && list[0]) choose(list[0].personId); if (e.key === "Escape") setOpen(false); }}
              className="rounded-md border bg-background p-2 text-sm" />
            <div className="flex flex-col gap-0.5 overflow-y-auto">
              {list.map((p) => (
                <button key={p.personId} onClick={() => choose(p.personId)}
                  className={`flex items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-muted md:py-1 ${p.personId === value ? "bg-muted" : ""}`}>
                  <PersonAvatar id={p.personId} name={p.name} />
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{countLabel(p)}</span>
                </button>
              ))}
              {!list.length && <span className="p-2 text-sm text-muted-foreground">No match</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface NamedPerson { id: string; name: string; hidden: boolean }
let personsCache: NamedPerson[] | null = null;
interface PickTarget { id: string; name: string }

/** "Assign to…": searchable list of all named people; suggested people first. */
function PersonPicker({ suggested, onPick, onClose }: {
  suggested?: { personId: string; label: string }[]; onPick: (t: PickTarget) => void; onClose: () => void;
}) {
  const [all, setAll] = useState<NamedPerson[]>(personsCache ?? []);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (personsCache) return;
    axios.get<NamedPerson[]>("/api/faces/persons").then(({ data }) => { personsCache = data; setAll(data); });
  }, []);
  const list = all.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (p: NamedPerson | undefined) => { if (p) onPick({ id: p.id, name: p.name }); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 p-2 pt-[10vh]" onClick={onClose}>
      <div className="flex max-h-[75vh] w-full max-w-sm flex-col gap-2 rounded-lg border bg-background p-3 text-foreground shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="font-semibold">Assign to…</span>
          <button onClick={onClose} title="Close (Esc)"><X className="h-5 w-5" /></button>
        </div>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); pick(list[0]); } }}
          className="rounded-md border bg-background p-2 text-sm" />
        {!q && !!suggested?.length && (
          <div className="flex flex-col gap-1 border-b pb-2">
            <span className="text-xs text-muted-foreground">Suggested</span>
            {suggested.map((s) => {
              const p = all.find((x) => x.id === s.personId);
              return (
                <button key={s.personId} className="flex items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-muted md:py-1"
                  onClick={() => onPick({ id: s.personId, name: p?.name ?? s.label })}>
                  <PersonAvatar id={s.personId} name={p?.name ?? s.label} />
                  <span className="truncate">{s.label}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-col gap-0.5 overflow-y-auto">
          {list.map((p) => (
            <button key={p.id} className="flex items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-muted md:py-1" onClick={() => pick(p)}>
              <PersonAvatar id={p.id} name={p.name} />
              <span className="truncate">{p.name}</span>
              {p.hidden && <span className="text-xs text-muted-foreground">hidden</span>}
            </button>
          ))}
          {!list.length && <span className="p-2 text-sm text-muted-foreground">{all.length ? "No match" : "Loading …"}</span>}
        </div>
      </div>
    </div>
  );
}

interface TileProps {
  f: Face; birth: string | null; selected: boolean; oneClick: boolean; size: number; group?: GroupInfo; inGroupDetail?: boolean;
  onImageClick: (e: React.MouseEvent) => void; onToggle?: () => void; onSecond: () => void; onDelete: () => void; onView: () => void;
  onStranger?: () => void; onInclude?: () => void; onLongPress?: () => void;
}
function FaceTile({ f, birth, selected, oneClick, size, group, inGroupDetail, onImageClick, onToggle, onSecond, onDelete, onView, onStranger, onInclude, onLongPress }: TileProps) {
  const age = ageAt(birth, f.capturedAt);
  const excluded = !!f.excluded;
  return (
    <div className={`rounded-md border p-1 text-xs ${selected ? "border-primary bg-primary/10" : "border-border"} ${excluded && inGroupDetail ? "opacity-40" : ""}`} style={{ width: size + 10 }}>
      {/* Click area: only the image. All buttons live below it, so a near-miss can't trigger anything. */}
      <FaceCrop assetId={f.assetId} box={f} size={size} onClick={onImageClick} onLongPress={oneClick ? undefined : onLongPress}
        className={oneClick ? "cursor-copy" : "cursor-pointer"}
        title={inGroupDetail ? "Click: full photo" : oneClick ? (f.suggestedName ? `Click: assign to ${f.suggestedName} now` : "No suggestion") : "Click: select · Shift+click: range"}>
        {!inGroupDetail && f.currentPersonId && (
          <span className="pointer-events-none absolute left-1 top-1 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-white"
            title={excluded ? "Excluded from a group" : "Belongs to an unnamed group"}>
            <Users className="h-3 w-3" />{group?.size ?? ""}{excluded ? " · excluded" : ""}
          </span>
        )}
      </FaceCrop>
      <div className="mt-2 flex items-center gap-1">
        {onToggle && !oneClick && <Checkbox checked={selected} onCheckedChange={onToggle} />}
        {f.secondName ? (
          <button onClick={onSecond} title="Assign to the runner-up now"
            className="min-w-0 flex-1 truncate rounded border px-1.5 py-1.5 text-left hover:bg-muted md:py-0.5">
            → {f.secondName} {fmtD(f.secondDistance)}
          </button>
        ) : <span className="flex-1" />}
        {!inGroupDetail && <button onClick={onView} title="View full photo" className="rounded border p-1.5 hover:bg-muted md:p-1"><Maximize2 className="h-3.5 w-3.5" /></button>}
        <DeleteButton onDelete={onDelete} />
      </div>
      {inGroupDetail && (excluded
        ? onInclude && <button onClick={onInclude} className="mt-1 w-full rounded border px-1.5 py-1.5 hover:bg-muted md:py-0.5">Include again</button>
        : onStranger && (
          <button onClick={onStranger} title="Not someone you know – hide this face in the tool"
            className="mt-1 flex w-full items-center justify-center gap-1 rounded border px-1.5 py-1.5 hover:bg-muted md:py-0.5">
            <EyeOff className="h-3.5 w-3.5" />Stranger
          </button>
        ))}
      <div className="mt-1 flex items-center justify-between gap-1 text-muted-foreground">
        <span className="font-mono text-foreground">{fmtD(f.distance)}{inGroupDetail && f.suggestedName ? ` ${f.suggestedName}` : ""}</span>
        <span className="truncate">{fmtDate(f.capturedAt)}{age != null ? ` · ${age.toFixed(1)} y` : ""}</span>
      </div>
      {!f.suggestedName && <div className="mt-1 text-muted-foreground">no suggestion</div>}
    </div>
  );
}

function GroupTile({ g, names, selected, size, onToggle, onOpen, onHide, onLongPress, onAssignTo }: {
  g: GroupRow; names: Record<string, string>; selected: boolean; size: number;
  onToggle: (e: React.MouseEvent) => void; onOpen: () => void; onHide: () => void; onLongPress: () => void; onAssignTo: () => void;
}) {
  return (
    <div className={`rounded-md border p-1 text-xs ${selected ? "border-primary bg-primary/10" : "border-border"}`} style={{ width: size + 10 }}>
      {g.rep
        ? <FaceCrop assetId={g.rep.assetId} box={g.rep} size={size} onClick={onToggle} onLongPress={onLongPress} className="cursor-pointer" title="Click: select · Shift+click / long press: range" />
        : <div style={{ width: size, height: size }} className="rounded bg-muted" />}
      <div className="mt-2 flex items-center gap-1">
        <Checkbox checked={selected} onCheckedChange={() => onToggle({} as React.MouseEvent)} />
        <span className="flex-1 truncate font-medium text-foreground">{g.size} faces</span>
        <button onClick={onHide} title="Stranger: hides this group here and in Immich. Undo via the log."
          className="rounded border px-1.5 py-1.5 hover:bg-muted md:py-0.5">Stranger</button>
        <button onClick={onAssignTo} title="Assign the whole group to someone else" className="rounded border p-1.5 hover:bg-muted md:p-1"><UserPlus className="h-3.5 w-3.5" /></button>
        <button onClick={onOpen} title="Review the faces of this group" className="rounded border p-1.5 hover:bg-muted md:p-1"><Maximize2 className="h-3.5 w-3.5" /></button>
      </div>
      <div className="mt-1 truncate text-muted-foreground" title={breakdownText(g.breakdown, names)}>
        {breakdownText(g.breakdown, names)}{g.noSuggestion ? ` · ${g.noSuggestion} without suggestion` : ""}
      </div>
      {g.excluded > 0 && <div className="text-muted-foreground">{g.excluded} excluded</div>}
    </div>
  );
}

/** Warning dialog for irreversible actions. Confirm with Del (again) or the red button; Enter does nothing on purpose. */
function DangerConfirm({ title, children, confirmLabel, onConfirm, onCancel }: {
  title: string; children: React.ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Delete") onConfirm();
      else if (e.key === "Escape") onCancel();
      else if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onConfirm, onCancel]);
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onClick={onCancel}>
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border-2 border-red-600 bg-background p-4 text-foreground shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-lg font-semibold text-red-600"><Trash2 className="h-5 w-5" />{title}</div>
        <div className="text-sm">{children}</div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel <kbd className="ml-2 hidden opacity-60 md:inline">Esc</kbd></Button>
          <Button variant="destructive" onClick={onConfirm}>{confirmLabel} <kbd className="ml-2 hidden opacity-60 md:inline">Del</kbd></Button>
        </div>
      </div>
    </div>
  );
}

interface ViewerProps {
  f: Face; index: number; count: number; total: number; birth: string | null; exUrl: string; group?: GroupInfo;
  onClose: () => void; onPrev: () => void; onNext: () => void;
  onAssign: () => void; onSecond: () => void; onStranger: () => void; onDelete: () => void;
  onAssignTo: (t: PickTarget) => void; onNewPerson: () => void;
}
/** Full-photo overlay with the face outlined.
 * Keys: Enter suggestion · 2 runner-up · A assign to… · S stranger · N new person · Del 2× no face · ←/→ · Esc. */
function FaceViewer(p: ViewerProps) {
  const { f, index, total, birth, exUrl, group } = p;
  const [armed, setArmed] = useState(false);
  const [picking, setPicking] = useState(false);
  useEffect(() => { setArmed(false); }, [f.faceId]);
  useEffect(() => {
    if (picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") p.onClose();
      else if (e.key === "ArrowLeft") p.onPrev();
      else if (e.key === "ArrowRight") p.onNext();
      else if (e.key === "Enter") { if (f.suggestedPersonId) p.onAssign(); }
      else if (e.key === "2") { if (f.secondPersonId) p.onSecond(); }
      else if (e.key === "a" || e.key === "A") setPicking(true);
      else if (e.key === "s" || e.key === "S") p.onStranger();
      else if (e.key === "n" || e.key === "N") p.onNewPerson();
      else if (e.key === "Delete") { if (armed) p.onDelete(); else setArmed(true); }
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [f, armed, p, picking]);
  const box = { left: `${(f.x1 / f.w) * 100}%`, top: `${(f.y1 / f.h) * 100}%`, width: `${((f.x2 - f.x1) / f.w) * 100}%`, height: `${((f.y2 - f.y1) / f.h) * 100}%` };
  const age = ageAt(birth, f.capturedAt);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const swipe = useSwipe(p.onNext, p.onPrev);
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-black/85 p-2 text-white md:p-4" onClick={p.onClose} {...swipe}>
      <div className="relative w-full max-w-[90vw] text-center" onClick={stop}>
        <div className="pr-16 text-base font-semibold md:px-40 md:text-xl">
          {index + 1} / {total} · d={fmtD(f.distance)} · {fmtDate(f.capturedAt)}{age != null ? ` · ${age.toFixed(1)} y` : ""}
        </div>
        {f.currentPersonId && group && (
          <div className="mt-1 text-sm opacity-80"><Users className="mr-1 inline h-3.5 w-3.5" />from a group of {group.size} faces{f.excluded ? " (excluded)" : ""}</div>
        )}
        <span className="absolute right-0 top-0 flex items-center gap-2">
          <Button asChild size="sm" variant="secondary" className="hidden md:inline-flex">
            <a href={`${exUrl}/photos/${f.assetId}`} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-4 w-4" />Open in Immich</a>
          </Button>
          <Button asChild size="sm" variant="secondary" className="md:hidden" title="Open in Immich">
            <a href={`${exUrl}/photos/${f.assetId}`} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>
          </Button>
          <Button size="sm" variant="secondary" onClick={p.onClose} title="Close (Esc)"><X className="h-4 w-4" /></Button>
        </span>
      </div>
      <div className="flex items-center gap-2" onClick={stop}>
        <button onClick={p.onPrev} disabled={index === 0} className="hidden rounded p-2 hover:bg-white/10 disabled:opacity-30 md:block" title="Previous (←)"><ChevronLeft className="h-8 w-8" /></button>
        <div className="relative inline-block">
          <img key={f.assetId} src={`/api/immich-proxy/asset/thumbnail/${f.assetId}?size=preview`} alt="" className="block max-h-[62vh] max-w-[96vw] object-contain md:max-h-[70vh] md:max-w-[80vw]" />
          <div className="pointer-events-none absolute rounded-sm border-2 border-yellow-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" style={box} />
        </div>
        <button onClick={p.onNext} disabled={index >= p.count - 1 && p.count >= total} className="hidden rounded p-2 hover:bg-white/10 disabled:opacity-30 md:block" title="Next (→)"><ChevronRight className="h-8 w-8" /></button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 [&_button]:h-11 md:[&_button]:h-9" onClick={stop}>
        {f.suggestedName
          ? <Button size="sm" onClick={p.onAssign}>→ {f.suggestedName} <kbd className="ml-2 hidden opacity-60 md:inline">Enter</kbd></Button>
          : <span className="text-sm opacity-70">no suggestion</span>}
        {f.secondName && <Button size="sm" variant="secondary" onClick={p.onSecond}>→ {f.secondName} {fmtD(f.secondDistance)} <kbd className="ml-2 hidden opacity-60 md:inline">2</kbd></Button>}
        <Button size="sm" variant="secondary" onClick={() => setPicking(true)}><UserPlus className="mr-1 h-3.5 w-3.5" />Assign to… <kbd className="ml-2 hidden opacity-60 md:inline">A</kbd></Button>
        <Button size="sm" variant="secondary" onClick={p.onStranger} title="Not someone you know – hide this face in the tool">
          <EyeOff className="mr-1 h-3.5 w-3.5" />Stranger <kbd className="ml-2 hidden opacity-60 md:inline">S</kbd>
        </Button>
        <Button size="sm" variant="secondary" onClick={p.onNewPerson} title="Create a new named person for this face">
          <PenLine className="mr-1 h-3.5 w-3.5" />New person <kbd className="ml-2 hidden opacity-60 md:inline">N</kbd>
        </Button>
        <Button size="sm" variant={armed ? "destructive" : "secondary"} onClick={() => (armed ? p.onDelete() : setArmed(true))}>
          <Trash2 className="mr-1 h-3.5 w-3.5" />{armed ? "Sure? Press again" : "No face"} <kbd className="ml-2 hidden opacity-60 md:inline">Del</kbd>
        </Button>
      </div>
      {picking && (
        <div onClick={stop}>
          <PersonPicker
            suggested={[
              ...(f.suggestedPersonId && f.suggestedName ? [{ personId: f.suggestedPersonId, label: `${f.suggestedName} (suggestion)` }] : []),
              ...(f.secondPersonId && f.secondName ? [{ personId: f.secondPersonId, label: `${f.secondName} (runner-up)` }] : []),
            ]}
            onPick={(t) => { setPicking(false); p.onAssignTo(t); }} onClose={() => setPicking(false)} />
        </div>
      )}
    </div>
  );
}

/** Group detail: all faces of one unnamed group, with stranger, runner-up, delete and the photo viewer. */
function GroupDetail({ clusterId, personName, names: initialNames, birth, exUrl, index, count, busy, cols,
  onClose, onPrev, onNext, onApply, onHide, onApplyTo, onDeleteGroup, onName, onNewPersonFace, setMsg, personId }: {
  clusterId: string; personId: string; personName?: string; names: Record<string, string>; birth: string | null; exUrl: string;
  index: number; count: number; busy: boolean; cols: number;
  onClose: () => void; onPrev: () => void; onNext: () => void; onApply: () => void; onHide: () => void;
  onApplyTo: (t: PickTarget) => void; onDeleteGroup: () => void; onName: () => void;
  onNewPersonFace: (f: Face) => Promise<boolean>;
  setMsg: (m: string, undoLogIds?: number[]) => void;
}) {
  const [faces, setFaces] = useState<Face[]>([]);
  const [info, setInfo] = useState<GroupInfo | undefined>();
  const [names, setNames] = useState(initialNames);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [cluster, setCluster] = useState<{ exists: boolean; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [gridRef, gridW] = useElementWidth<HTMLDivElement>();
  const tileSize = cols && gridW ? tileFor(gridW, cols) : SIZES.S;
  const load = useCallback(async () => {
    const { data } = await axios.get("/api/faces/suggestions", { params: { clusterId, personId, limit: 1000 } });
    setFaces(data.faces); setInfo(data.groups[clusterId]); setNames((n) => ({ ...n, ...data.names })); setCluster(data.cluster);
  }, [clusterId, personId]);
  useEffect(() => { load(); }, [load]);
  // Keys for the group itself (the photo viewer has its own while open).
  // A group that got a name in Immich (or was removed) since the scan must not be touched as a group any more.
  const locked = !!cluster && (!cluster.exists || cluster.name !== "");
  useEffect(() => {
    if (viewIndex !== null || picking || confirmDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onPrev();
      else if (e.key === "ArrowRight") onNext();
      else if (locked) return;
      else if (e.key === "Enter") onApply();
      else if (e.key === "a" || e.key === "A") setPicking(true);
      else if (e.key === "s" || e.key === "S") onHide();
      else if (e.key === "n" || e.key === "N") onName();
      else if (e.key === "Delete") setConfirmDelete(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [viewIndex, picking, confirmDelete, busy, locked, onClose, onPrev, onNext, onApply, onHide, onName]);
  useEffect(() => { if (viewIndex !== null && viewIndex >= faces.length) setViewIndex(faces.length ? faces.length - 1 : null); }, [viewIndex, faces.length]);

  const remove = (f: Face) => setFaces((prev) => prev.filter((x) => x.faceId !== f.faceId));
  const setExcluded = async (f: Face, value: boolean) => {
    setFaces((prev) => prev.map((x) => (x.faceId === f.faceId ? { ...x, excluded: value } : x)));
    try { await axios.post("/api/faces/exclude", { faceIds: [f.faceId], include: !value }); }
    catch (e: any) { setMsg(e?.response?.data?.message || String(e)); load(); }
  };
  const assign = async (f: Face, to?: string | null, toName?: string | null) => {
    const target = to || f.suggestedPersonId;
    if (!target) return setMsg("No suggestion for this face");
    remove(f);
    try {
      const { data } = await axios.post("/api/faces/apply", { faceIds: [f.faceId], personId: target });
      const r = data.results?.[0];
      if (r?.ok) setMsg(`Assigned → ${toName ?? f.suggestedName ?? ""}`, r.logId ? [r.logId] : undefined);
      else { setMsg(`Error: ${r?.error ?? "unknown"}`); load(); }
    } catch (e: any) { setMsg(e?.response?.data?.message || String(e)); load(); }
  };
  const stranger = async (f: Face) => {
    remove(f);
    try {
      const { data } = await axios.post("/api/faces/reject", { faceIds: [f.faceId] });
      setMsg("Hidden as stranger", data.logIds);
    }
    catch (e: any) { setMsg(e?.response?.data?.message || String(e)); load(); }
  };
  const newPerson = async (f: Face) => { if (await onNewPersonFace(f)) remove(f); };
  const del = async (f: Face) => {
    remove(f);
    try {
      const { data } = await axios.post("/api/faces/delete", { faceIds: [f.faceId] });
      if (!data.results?.[0]?.ok) { setMsg(`Delete failed: ${data.results?.[0]?.error ?? "unknown"}`); load(); }
    } catch (e: any) { setMsg(e?.response?.data?.message || String(e)); load(); }
  };
  const excludedCount = faces.filter((f) => f.excluded).length;
  const vf = viewIndex !== null ? faces[viewIndex] : undefined;
  const swipe = useSwipe(onNext, onPrev);
  const suggested = (info?.breakdown ?? []).map((b) => ({ personId: b.personId, label: `${names[b.personId] ?? "?"} (${b.n} suggestions)` }));
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background p-2 md:bg-background/95 md:p-4">
      <div className="flex flex-wrap items-center gap-2 border-b pb-2 md:gap-3 md:pb-3">
        <button onClick={onPrev} disabled={index === 0} className="rounded p-1 hover:bg-muted disabled:opacity-30" title="Previous group (←)"><ChevronLeft className="h-6 w-6" /></button>
        <span className="text-sm text-muted-foreground">{index + 1} / {count}</span>
        <button onClick={onNext} disabled={index >= count - 1} className="rounded p-1 hover:bg-muted disabled:opacity-30" title="Next group (→)"><ChevronRight className="h-6 w-6" /></button>
        <Users className="h-5 w-5" />
        <span className="text-lg font-semibold">Group · {info?.size ?? faces.length} faces</span>
        <span className="text-sm text-muted-foreground">Suggestions: {breakdownText(info?.breakdown, names)}</span>
        <Button asChild size="sm" variant="outline">
          <a href={`${exUrl}/people/${clusterId}`} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 md:mr-1" /><span className="hidden md:inline">Open group in Immich</span></a>
        </Button>
        <span className="flex-1" />
        <Button size="sm" className="hidden md:inline-flex" disabled={busy || locked} onClick={onApply}>
          Assign whole group → {personName}{excludedCount ? ` (without ${excludedCount} excluded)` : ""} <kbd className="ml-2 opacity-60">Enter</kbd>
        </Button>
        <Button size="sm" variant="outline" className="hidden md:inline-flex" disabled={busy || locked} onClick={() => setPicking(true)}>
          <UserPlus className="mr-1 h-4 w-4" />Assign to… <kbd className="ml-2 opacity-60">A</kbd>
        </Button>
        <Button size="sm" variant="outline" className="hidden md:inline-flex" disabled={busy || locked} onClick={onName} title="Give this group a name in Immich (it becomes a new named person)">
          <PenLine className="mr-1 h-4 w-4" />New person <kbd className="ml-2 opacity-60">N</kbd>
        </Button>
        <Button size="sm" variant="outline" className="hidden md:inline-flex" disabled={busy || locked} onClick={onHide} title="Hides this group here and in Immich. Undo via the log.">
          <EyeOff className="mr-1 h-4 w-4" />Stranger <kbd className="ml-2 opacity-60">S</kbd>
        </Button>
        <Button size="sm" variant="outline" className="hidden md:inline-flex" disabled={busy || locked}
          onClick={() => setConfirmDelete(true)} title="Delete all face detections of this group in Immich">
          <Trash2 className="mr-1 h-4 w-4" />No face <kbd className="ml-2 opacity-60">Del</kbd>
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}><X className="h-4 w-4 md:mr-1" /><span className="hidden md:inline">Close</span></Button>
      </div>
      {locked && (
        <div className="my-2 rounded-md border border-yellow-500 bg-yellow-500/10 p-2 text-sm">
          {cluster?.exists
            ? <>This group is now named <b>{cluster.name}</b> in Immich. Group actions are disabled – it is no longer an unnamed group.</>
            : <>This group no longer exists in Immich. Group actions are disabled.</>}
        </div>
      )}
      <p className="hidden py-2 text-xs text-muted-foreground md:block">
        Click a face for the full photo. Decide outliers right away – assign them to someone else, mark them as stranger or as no face; &quot;Whole group&quot; then skips them.
      </p>
      <div ref={gridRef} className="flex flex-1 flex-wrap content-start gap-2 overflow-y-auto py-2" {...swipe}>
        {faces.map((f, i) => (
          <FaceTile key={f.faceId} f={f} birth={birth} selected={false} oneClick={false} size={tileSize} inGroupDetail
            onImageClick={() => setViewIndex(i)} onView={() => setViewIndex(i)}
            onSecond={() => assign(f, f.secondPersonId, f.secondName)} onDelete={() => del(f)}
            onStranger={() => stranger(f)} onInclude={() => setExcluded(f, false)} />
        ))}
        {!faces.length && <p className="text-sm text-muted-foreground">No open faces left in this group.</p>}
      </div>
      {/* Thumb-reachable actions on phones */}
      <div className="flex flex-col gap-2 border-t pt-2 md:hidden">
        <Button className="h-11 w-full min-w-0" disabled={busy || locked} onClick={onApply}>
          <span className="truncate">Whole group → {personName}{excludedCount ? ` (−${excludedCount})` : ""}</span>
        </Button>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Assign", icon: <UserPlus className="h-5 w-5" />, onClick: () => setPicking(true) },
            { label: "New", icon: <PenLine className="h-5 w-5" />, onClick: onName },
            { label: "Stranger", icon: <EyeOff className="h-5 w-5" />, onClick: onHide },
            { label: "No face", icon: <Trash2 className="h-5 w-5" />, onClick: () => setConfirmDelete(true) },
          ].map((b) => (
            <button key={b.label} disabled={busy || locked} onClick={b.onClick}
              className="flex flex-col items-center gap-0.5 rounded-md border py-1.5 text-xs hover:bg-muted disabled:opacity-40">
              {b.icon}<span>{b.label}</span>
            </button>
          ))}
        </div>
      </div>
      {picking && (
        <PersonPicker suggested={suggested} onPick={(t) => { setPicking(false); onApplyTo(t); }} onClose={() => setPicking(false)} />
      )}
      {confirmDelete && (
        <DangerConfirm title="Delete face detections" confirmLabel={`Delete ${faces.length - excludedCount} face detections`}
          onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); onDeleteGroup(); }}>
          <p>Delete <b>all {faces.length - excludedCount} face detections</b> of this group in Immich?</p>
          <p className="mt-2">The photos themselves are <b>not</b> deleted. But the face detections <b>cannot be restored</b> from this tool – only from a database snapshot.</p>
          {excludedCount > 0 && <p className="mt-2">{excludedCount} excluded faces are kept.</p>}
        </DangerConfirm>
      )}
      {vf && viewIndex !== null && (
        <FaceViewer f={vf} index={viewIndex} count={faces.length} total={faces.length} birth={birth} exUrl={exUrl} group={info}
          onClose={() => setViewIndex(null)}
          onPrev={() => setViewIndex((i) => (i === null ? i : Math.max(0, i - 1)))}
          onNext={() => setViewIndex((i) => (i === null ? i : Math.min(faces.length - 1, i + 1)))}
          onAssign={() => assign(vf)}
          onSecond={() => assign(vf, vf.secondPersonId, vf.secondName)}
          onStranger={() => stranger(vf)} onNewPerson={() => newPerson(vf)}
          onDelete={() => del(vf)} onAssignTo={(t) => assign(vf, t.id, t.name)} />
      )}
    </div>
  );
}

export default function UnnamedFacesPage() {
  const { exImmichUrl } = useConfig();
  const [mode, setMode] = useState<Mode>("groups");
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [personId, setPersonId] = useState("");
  const [dateMode, setDateMode] = useState<DateMode>("hidePre");
  const [origin, setOrigin] = useState<Origin>("loose");
  const [faces, setFaces] = useState<Face[]>([]);
  const [total, setTotal] = useState(0);
  const [birth, setBirth] = useState<string | null>(null);
  const [groupsInfo, setGroupsInfo] = useState<Record<string, GroupInfo>>({});
  const [groupList, setGroupList] = useState<GroupRow[]>([]);
  const [groupTotal, setGroupTotal] = useState(0);
  const [names, setNames] = useState<Record<string, string>>({});
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [oneClick, setOneClick] = useState(false);
  const [size, setSize] = useState<Size>("M");
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: number[]; key: number } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pickGroup, setPickGroup] = useState<GroupRow | null>(null);
  const [sortSingle, setSortSingle] = useState<SortState>({ key: "distance", dir: "asc" });
  const [sortGroups, setSortGroups] = useState<SortState>({ key: "size", dir: "desc" });
  useEffect(() => { setSortSingle(loadSort("single")); setSortGroups(loadSort("groups")); }, []);
  const sort = mode === "groups" ? sortGroups : sortSingle;
  const setSort = (v: SortState) => {
    saveSort(mode, v);
    if (mode === "groups") setSortGroups(v); else setSortSingle(v);
  };
  const vw = useViewportWidth();
  const mobile = vw < 768;
  const [scan, setScan] = useState<any>(null);
  const [view, setView] = useState<"review" | "log">("review");
  const [log, setLog] = useState<LogRow[]>([]);
  const [logSel, setLogSel] = useState<Set<number>>(new Set());
  const lastIndex = useRef<number | null>(null);
  const lastLogIndex = useRef<number | null>(null);
  const [gridRef, gridW] = useElementWidth<HTMLDivElement>();

  /** Status line at the bottom (thumb reach). Optional Undo for the action it reports; replaced by the next message. */
  const setMsg = useCallback((m: string, undo?: number[]) => {
    setToast(m ? { text: m, undo: undo?.length ? undo : undefined, key: Date.now() } : null);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast((x) => (x?.key === toast.key ? null : x)), toast.undo ? 8000 : 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const loadPeople = useCallback(async () => {
    const { data } = await axios.get<PersonRow[]>("/api/faces/people");
    setPeople(data);
    setPersonId((p) => p || data[0]?.personId || "");
  }, []);
  /** Reload the current list (faces or groups). Keeps selection for items still listed. Returns the new length. */
  const loadList = useCallback(async (count?: number, forceSync = false): Promise<number> => {
    if (!personId) { setFaces([]); setTotal(0); setGroupList([]); setGroupTotal(0); return 0; }
    if (mode === "groups") {
      const { data } = await axios.get("/api/faces/groups", { params: { personId, sort: sortGroups.key, dir: sortGroups.dir, limit: count || GROUP_PAGE, offset: 0, sync: forceSync ? 1 : undefined } });
      const ids = new Set<string>((data.groups as GroupRow[]).map((g) => g.clusterId));
      setGroupList(data.groups); setGroupTotal(data.total); setNames((n) => ({ ...n, ...data.names }));
      setSelected((prev) => new Set(Array.from(prev).filter((id) => ids.has(id))));
      return data.groups.length;
    }
    const { data } = await axios.get("/api/faces/suggestions", { params: { personId, dateMode, origin, sort: sortSingle.key, dir: sortSingle.dir, limit: count || PAGE, offset: 0, sync: forceSync ? 1 : undefined } });
    const ids = new Set<string>((data.faces as Face[]).map((f) => f.faceId));
    setFaces(data.faces); setTotal(data.total); setBirth(data.birthDate); setGroupsInfo(data.groups); setNames((n) => ({ ...n, ...data.names }));
    setSelected((prev) => new Set(Array.from(prev).filter((id) => ids.has(id))));
    return data.faces.length;
  }, [mode, personId, dateMode, origin, sortSingle, sortGroups]);
  const loadMore = async () => {
    if (mode === "groups") {
      const { data } = await axios.get("/api/faces/groups", { params: { personId, sort: sortGroups.key, dir: sortGroups.dir, limit: GROUP_PAGE, offset: groupList.length } });
      const known = new Set(groupList.map((g) => g.clusterId));
      setGroupList((prev) => [...prev, ...(data.groups as GroupRow[]).filter((g) => !known.has(g.clusterId))]); setGroupTotal(data.total);
      setNames((n) => ({ ...n, ...data.names }));
    } else {
      const { data } = await axios.get("/api/faces/suggestions", { params: { personId, dateMode, origin, sort: sortSingle.key, dir: sortSingle.dir, limit: PAGE, offset: faces.length } });
      const known = new Set(faces.map((f) => f.faceId));
      setFaces((prev) => [...prev, ...(data.faces as Face[]).filter((f) => !known.has(f.faceId))]); setTotal(data.total);
      setGroupsInfo((g) => ({ ...g, ...data.groups })); setNames((n) => ({ ...n, ...data.names }));
    }
  };
  const loadLog = useCallback(async () => {
    const { data } = await axios.get<LogRow[]>("/api/faces/log");
    setLog(data); setLogSel(new Set()); lastLogIndex.current = null;
  }, []);
  const loadScan = useCallback(async () => { const { data } = await axios.get("/api/faces/scan"); setScan(data); return data; }, []);

  useEffect(() => { loadPeople(); loadScan(); }, [loadPeople, loadScan]);
  useEffect(() => { setSelected(new Set()); lastIndex.current = null; setViewIndex(null); setOpenIdx(null); }, [mode, personId, dateMode, origin, sortSingle, sortGroups]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (view === "log") loadLog(); }, [view, loadLog]);
  useEffect(() => {
    if (!scan?.running) return;
    const t = setInterval(async () => { await loadScan(); loadPeople(); }, 5000);
    return () => clearInterval(t);
  }, [scan?.running, loadScan, loadPeople]);

  const current = people.find((p) => p.personId === personId);
  const listLen = mode === "groups" ? groupList.length : faces.length;
  const listTotal = mode === "groups" ? groupTotal : total;
  const allSelected = listLen > 0 && selected.size === listLen;
  const neverScanned = scan && !scan.running && !scan.done && !scan.scanned && !people.length;

  const removeFace = (f: Face) => {
    setFaces((prev) => prev.filter((x) => x.faceId !== f.faceId));
    setTotal((t) => Math.max(0, t - 1));
    setSelected((s) => { const n = new Set(s); n.delete(f.faceId); return n; });
  };
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  /** Long press (touch): select everything from the last selected item up to this one. */
  const rangeTo = (index: number) => {
    const ids = mode === "groups" ? groupList.map((g) => g.clusterId) : faces.map((f) => f.faceId);
    const from = lastIndex.current ?? index;
    const [a, b] = from < index ? [from, index] : [index, from];
    setSelected((s) => { const n = new Set(s); ids.slice(a, b + 1).forEach((x) => n.add(x)); return n; });
    lastIndex.current = index;
  };
  const clickSelect = (id: string, index: number) => (e?: React.MouseEvent) => {
    if (e?.shiftKey && lastIndex.current !== null) {
      const from = lastIndex.current;
      const [a, b] = from < index ? [from, index] : [index, from];
      const ids = mode === "groups" ? groupList.map((g) => g.clusterId) : faces.map((f) => f.faceId);
      setSelected((s) => { const n = new Set(s); ids.slice(a, b + 1).forEach((x) => n.add(x)); return n; });
    } else toggle(id);
    lastIndex.current = index;
  };

  /** Assign one face immediately (one-click mode, overlay, runner-up button). Optimistic: the tile disappears at once. */
  const assignNow = async (f: Face, target?: string | null, targetName?: string | null) => {
    const to = target || f.suggestedPersonId;
    if (!to) { setMsg("No suggestion for this face"); return; }
    removeFace(f);
    try {
      const { data } = await axios.post("/api/faces/apply", { faceIds: [f.faceId], personId: to });
      const r = data.results?.[0];
      if (!r?.ok) { setMsg(`Error: ${r?.error ?? "unknown"}`); loadList(faces.length); }
      else setMsg(`Assigned → ${targetName ?? f.suggestedName ?? ""}`, r.logId ? [r.logId] : undefined);
    } catch (e: any) { setMsg(e?.response?.data?.message || String(e)); loadList(faces.length); }
  };
  const deleteNow = async (f: Face) => {
    removeFace(f);
    try {
      const { data } = await axios.post("/api/faces/delete", { faceIds: [f.faceId] });
      const r = data.results?.[0];
      if (!r?.ok) { setMsg(`Delete failed: ${r?.error ?? "unknown"}`); loadList(faces.length); } else setMsg("Face detection deleted");
    } catch (e: any) { setMsg(e?.response?.data?.message || String(e)); loadList(faces.length); }
  };
  const rejectNow = async (f: Face) => {
    removeFace(f);
    try { const { data } = await axios.post("/api/faces/reject", { faceIds: [f.faceId] }); setMsg("Hidden as stranger", data.logIds); }
    catch (e: any) { setMsg(e?.response?.data?.message || String(e)); loadList(faces.length); }
  };

  /** After a group was handled in the detail view: reload and stay on the same index (= next group). */
  const afterGroupAction = async () => {
    const n = await loadList(Math.max(groupList.length, GROUP_PAGE));
    loadPeople();
    setOpenIdx((i) => (i === null ? null : n === 0 ? null : Math.min(i, n - 1)));
  };
  /** Assign whole groups to the selected person (excluded faces are skipped server-side). */
  const applyGroups = async (clusterIds: string[], ask: boolean, target?: PickTarget) => {
    if (!clusterIds.length) return;
    const to = target ?? (current ? { id: current.personId, name: current.name } : null);
    if (!to) return;
    const n = groupList.filter((g) => clusterIds.includes(g.clusterId)).reduce((a, g) => a + g.size - g.excluded, 0);
    if (ask && !confirm(`Assign ${clusterIds.length} group(s) with about ${n} faces to ${to.name}? Excluded faces are skipped.`)) return;
    setBusy(true); setMsg(`Assigning ${clusterIds.length} group(s) …`);
    try {
      const { data } = await axios.post("/api/faces/apply-group", { clusterIds, personId: to.id });
      const bad = (data.results as any[]).filter((r) => !r.ok);
      const undoIds = (data.results as any[]).filter((r) => r.ok && r.logId).map((r) => r.logId as number);
      setMsg(`${data.results.length - bad.length} faces → ${to.name}${data.skipped ? `, ${data.skipped} excluded skipped` : ""}${bad.length ? `, ${bad.length} errors: ${bad[0].error}` : ""}`, undoIds);
      await afterGroupAction();
    } catch (e: any) { setMsg(e?.response?.data?.message || String(e)); }
    setBusy(false);
  };
  const hideGroup = async (clusterId: string) => {
    setBusy(true);
    try {
      const { data } = await axios.post("/api/faces/hide-group", { clusterId });
      setMsg("Group hidden (also in Immich)", data.logId ? [data.logId] : undefined);
      await afterGroupAction();
    } catch (e: any) { setMsg(`Hiding failed: ${e?.response?.data?.error || e?.response?.data?.message || String(e)}`); }
    setBusy(false);
  };
  /** "No face" for a whole group – irreversible from the tool, so ask with a clear warning. */
  /** Confirmation happens in the group detail's warning dialog. */
  const deleteGroup = async (clusterId: string) => {
    setBusy(true); setMsg("Deleting face detections …");
    try {
      const { data } = await axios.post("/api/faces/delete-group", { clusterId });
      setMsg(`${data.deleted} face detections deleted${data.skipped ? `, ${data.skipped} excluded kept` : ""}${data.errors ? `, ${data.errors} errors: ${data.error}` : ""}`);
      await afterGroupAction();
    } catch (e: any) { setMsg(e?.response?.data?.message || String(e)); }
    setBusy(false);
  };
  /** Give an unnamed group a name in Immich; it then becomes a named person and leaves the list. */
  const nameGroup = async (clusterId: string) => {
    const name = window.prompt("Name for this group (creates a named person in Immich):")?.trim();
    if (!name) return;
    setBusy(true);
    try {
      const { data } = await axios.post("/api/faces/name-group", { clusterId, name });
      personsCache = null; // the new person must show up in "Assign to…"
      setMsg(`Group named "${name}"`, data.logId ? [data.logId] : undefined);
      await afterGroupAction(); await loadPeople();
    } catch (e: any) { setMsg(`Naming failed: ${e?.response?.data?.error || e?.response?.data?.message || String(e)}`); }
    setBusy(false);
  };
  /** "New person" for a single face: creates a named person in Immich and assigns the face to it. */
  const newPersonForFace = async (f: Face): Promise<boolean> => {
    const name = window.prompt("Name of the new person:")?.trim();
    if (!name) return false;
    try {
      const { data } = await axios.post("/api/faces/new-person", { faceId: f.faceId, name });
      personsCache = null;
      setMsg(`New person "${name}" created`, data.logId ? [data.logId] : undefined);
      loadPeople();
      return true;
    } catch (e: any) { setMsg(`Failed: ${e?.response?.data?.error || e?.response?.data?.message || String(e)}`); return false; }
  };
  const undoLogIds = async (ids: number[]) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const { data } = await axios.post("/api/faces/undo", { logIds: ids });
      const bad = (data.results as any[]).filter((r) => !r.ok);
      setMsg(`${ids.length - bad.length} undone${bad.length ? `, ${bad.length} errors: ${bad[0].error}` : ""}`);
    } catch (e: any) { setMsg(e?.response?.data?.message || String(e)); }
    setBusy(false);
    if (view === "log") loadLog(); else { loadList(listLen); loadPeople(); }
  };

  // Keep the viewer on a valid face when the list shrinks; fetch more when reaching the end.
  useEffect(() => {
    if (viewIndex === null) return;
    if (!faces.length) { setViewIndex(null); return; }
    if (viewIndex >= faces.length) setViewIndex(faces.length - 1);
    if (viewIndex >= faces.length - 2 && faces.length < total) loadMore();
  }, [viewIndex, faces.length, total]);

  const act = async (kind: "apply" | "reject" | "delete") => {
    if (mode === "groups") return applyGroups(Array.from(selected), true);
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (kind === "apply" && !confirm(`Assign ${ids.length} face(s) to ${current?.name}?`)) return;
    if (kind === "delete" && !confirm(`Delete ${ids.length} detection(s) in Immich as "no face"? The photos stay, but this cannot be undone from the tool.`)) return;
    setBusy(true); setMsg(kind === "apply" ? `Assigning ${ids.length} …` : kind === "delete" ? `Deleting ${ids.length} …` : "");
    try {
      const { data } = await axios.post(`/api/faces/${kind}`, { faceIds: ids });
      if (kind === "reject") setMsg(`${ids.length} hidden as strangers`, data.logIds);
      else {
        const bad = (data.results as any[]).filter((r) => !r.ok);
        const undoIds = kind === "apply" ? (data.results as any[]).filter((r) => r.ok && r.logId).map((r) => r.logId as number) : [];
        setMsg(`${ids.length - bad.length} ${kind === "apply" ? "assigned" : "deleted"}${bad.length ? `, ${bad.length} errors: ${bad[0].error}` : ""}`, undoIds);
      }
      await loadList(faces.length); await loadPeople();
    } catch (e: any) { setMsg(e?.response?.data?.message || String(e)); }
    setBusy(false);
  };

  const undoable = (r: LogRow) => ["assign", "hide-group", "name-group", "reject"].includes(r.action) && !!r.ok && !r.undoneAt;
  const logClick = (r: LogRow, index: number) => (e: React.MouseEvent) => {
    if (!undoable(r)) return;
    if (e.shiftKey && lastLogIndex.current !== null) {
      const [a, b] = lastLogIndex.current < index ? [lastLogIndex.current, index] : [index, lastLogIndex.current];
      setLogSel((s) => { const n = new Set(s); log.slice(a, b + 1).filter(undoable).forEach((x) => n.add(x.id)); return n; });
    } else setLogSel((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; });
    lastLogIndex.current = index;
  };
  const actionLabel: Record<string, string> = {
    assign: "assign", reject: "stranger (face)", delete: "no face", undo: "undo", exclude: "exclude", include: "include", "hide-group": "stranger (group hidden)", "name-group": "group named",
  };

  const vf = viewIndex !== null ? faces[viewIndex] : undefined;
  const og = openIdx !== null ? groupList[openIdx] : undefined;
  // Tiles: chosen size on desktop, two columns on phones.
  const tile = mobile && gridW ? tileFor(gridW, 2) : SIZES[size];
  const showBottomBar = mobile && view === "review" && selected.size > 0 && !(mode === "single" && oneClick);

  return (
    <PageLayout className="!w-full p-4">
      <Header leftComponent="Unnamed Faces" />
      <div className="sticky top-0 z-20 -mx-4 -mt-4 flex flex-col gap-3 border-b bg-background px-4 pb-3 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant={view === "review" ? "default" : "outline"} size="sm" onClick={() => setView("review")}>Suggestions</Button>
          <Button variant={view === "log" ? "default" : "outline"} size="sm" onClick={() => setView("log")}>Log</Button>
          <Button variant="outline" size="sm" disabled={scan?.running} onClick={async () => { await axios.post("/api/faces/scan", { reset: false }); loadScan(); }}>
            {scan?.running ? `Scanning … ${scan.scanned} checked, ${scan.stored} suggestions` : "Start / resume scan"}
          </Button>
          <Button variant="outline" size="sm" className="hidden md:inline-flex" disabled={scan?.running} onClick={async () => { if (confirm("Discard open suggestions and scan again from scratch?")) { await axios.post("/api/faces/scan", { reset: true }); loadScan(); } }}>
            Rescan
          </Button>
          {scan && !scan.running && (scan.scanned > 0 || scan.done) && (
            <span className="hidden text-xs text-muted-foreground md:inline">
              {scan.done ? "Scan complete" : "Scan incomplete"} · {scan.scanned} faces checked
              {scan.updatedAt ? ` · as of ${new Date(scan.updatedAt).toLocaleString()}` : ""}{scan.error ? ` · error: ${scan.error}` : ""}
            </span>
          )}
        </div>
        {view === "review" && !neverScanned && (
          <>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex overflow-hidden rounded-md border">
                <button className={`px-3 py-1.5 text-sm ${mode === "groups" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`} onClick={() => setMode("groups")}>
                  <Users className="mr-1 inline h-4 w-4" />Groups
                </button>
                <button className={`px-3 py-1.5 text-sm ${mode === "single" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`} onClick={() => setMode("single")}>
                  Single faces
                </button>
              </div>
              <PersonSelect people={people} value={personId} onChange={setPersonId}
                countLabel={(p) => (mode === "groups" ? `${p.groups} groups` : `${p.total} open`)} />
              {mode === "single" && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={oneClick} onCheckedChange={(v) => { setOneClick(!!v); setSelected(new Set()); }} />
                  One-click
                </label>
              )}
              <Button size="sm" variant="outline" className="md:hidden" onClick={() => setFiltersOpen((o) => !o)}>
                {mode === "single" ? "Filters" : "Sort"}{filtersOpen ? " ▴" : " ▾"}
              </Button>
              <div className={`${filtersOpen ? "flex" : "hidden"} w-full flex-col gap-2 md:flex md:w-auto md:flex-row md:gap-4`}>
                <SortControl mode={mode} value={sort} onChange={setSort} />
              </div>
              {mode === "single" && (
                <div className={`${filtersOpen ? "flex" : "hidden"} w-full flex-col gap-2 md:flex md:w-auto md:flex-row md:gap-4`}>
                  <select className="rounded-md border bg-background p-2 text-sm" value={dateMode} onChange={(e) => setDateMode(e.target.value as DateMode)}>
                    {(Object.keys(DATE_LABEL) as DateMode[]).map((m) => <option key={m} value={m}>{DATE_LABEL[m]}</option>)}
                  </select>
                  <select className="rounded-md border bg-background p-2 text-sm" value={origin} onChange={(e) => setOrigin(e.target.value as Origin)}>
                    {(Object.keys(ORIGIN_LABEL) as Origin[]).map((m) => <option key={m} value={m}>{ORIGIN_LABEL[m]}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="hidden items-center gap-1 md:flex">
                {(Object.keys(SIZES) as Size[]).map((k) => (
                  <Button key={k} size="sm" variant={size === k ? "default" : "outline"} onClick={() => setSize(k)}>{k}</Button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">
                {listLen} of {listTotal} {mode === "groups" ? "groups" : "faces"}, {sortHint(sort.key, sort.dir)}
                {mode === "single" && oneClick ? " · one-click: tap a photo to assign it" : ""}
              </span>
            </div>
            {!(mode === "single" && oneClick) && (
              <div className="hidden flex-wrap items-center gap-3 md:flex">
                <Button size="sm" variant="outline" onClick={() => setSelected(allSelected ? new Set() : new Set(mode === "groups" ? groupList.map((g) => g.clusterId) : faces.map((f) => f.faceId)))}>
                  {allSelected ? "Clear selection" : `Select all ${listLen}`}
                </Button>
                <Button size="sm" disabled={busy || !selected.size} onClick={() => act("apply")}>
                  Confirm {selected.size} {mode === "groups" ? "groups" : ""} → {current?.name}
                </Button>
                {mode === "single" && (
                  <>
                    <Button size="sm" variant="outline" disabled={busy || !selected.size} onClick={() => act("reject")} title="Not someone you know – hide in the tool"><EyeOff className="mr-1 h-3.5 w-3.5" />{selected.size} stranger</Button>
                    <Button size="sm" variant="outline" disabled={busy || !selected.size} onClick={() => act("delete")}><Trash2 className="mr-1 h-3.5 w-3.5" />{selected.size} no face</Button>
                  </>
                )}
                <Button size="sm" variant="outline" disabled={busy} onClick={() => { loadList(listLen, true); loadPeople(); }}>Refresh list</Button>
                <span className="text-xs text-muted-foreground">
                  {mode === "groups" ? "Shift+click: range · ⤢ opens a group to review its faces and exclude outliers" : "Shift+click: range · icon top left = face belongs to a group"}
                </span>
              </div>
            )}
          </>
        )}
        {view === "log" && (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={busy || !logSel.size} onClick={() => { if (confirm(`Undo ${logSel.size} entries?`)) undoLogIds(Array.from(logSel)); }}>
              Undo {logSel.size} selected
            </Button>
            <Button size="sm" variant="outline" onClick={() => setLogSel(logSel.size ? new Set() : new Set(log.filter(undoable).map((r) => r.id)))}>
              {logSel.size ? "Clear selection" : "Select all undoable"}
            </Button>
            <span className="text-xs text-muted-foreground">Click a row to select it, Shift+click for a range</span>
          </div>
        )}
      </div>

      {view === "review" ? (
        neverScanned ? (
          <div className="mx-auto mt-16 flex max-w-xl flex-col items-center gap-4 text-center">
            <Users className="h-12 w-12 text-muted-foreground" />
            <h2 className="text-xl font-semibold">No scan yet</h2>
            <p className="text-sm text-muted-foreground">
              The scan compares every face without a name to the faces of your named people and stores the closest match as a suggestion.
              It only reads from Immich and changes nothing. It can be paused and resumed at any time.
            </p>
            <Button onClick={async () => { await axios.post("/api/faces/scan", { reset: false }); loadScan(); }}>Start scan</Button>
          </div>
        ) : mode === "groups" ? (
          <>
            <div ref={gridRef} className="flex flex-wrap gap-2">
              {groupList.map((g, i) => (
                <GroupTile key={g.clusterId} g={g} names={names} selected={selected.has(g.clusterId)} size={tile}
                  onToggle={(e) => clickSelect(g.clusterId, i)(e)} onLongPress={() => rangeTo(i)}
                  onOpen={() => setOpenIdx(i)} onHide={() => hideGroup(g.clusterId)} onAssignTo={() => setPickGroup(g)} />
              ))}
              {!groupList.length && <p className="text-sm text-muted-foreground">No groups whose majority points to this person.</p>}
            </div>
            {groupList.length < groupTotal && <Button variant="outline" onClick={loadMore}>Load {Math.min(GROUP_PAGE, groupTotal - groupList.length)} more</Button>}
          </>
        ) : (
          <>
            <div ref={gridRef} className="flex flex-wrap gap-2">
              {faces.map((f, i) => (
                <FaceTile key={f.faceId} f={f} birth={birth ?? current?.birthDate ?? null} selected={selected.has(f.faceId)}
                  oneClick={oneClick} size={tile} group={f.currentPersonId ? groupsInfo[f.currentPersonId] : undefined}
                  onLongPress={() => rangeTo(i)}
                  onImageClick={(e) => (oneClick ? assignNow(f) : clickSelect(f.faceId, i)(e))}
                  onToggle={() => { toggle(f.faceId); lastIndex.current = i; }}
                  onSecond={() => assignNow(f, f.secondPersonId, f.secondName)}
                  onDelete={() => deleteNow(f)} onView={() => setViewIndex(i)} />
              ))}
              {!faces.length && <p className="text-sm text-muted-foreground">No open suggestions.</p>}
            </div>
            {faces.length < total && <Button variant="outline" onClick={loadMore}>Load {Math.min(PAGE, total - faces.length)} more</Button>}
          </>
        )
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th /><th>Time</th><th>Action</th><th>From</th><th>To</th><th>d</th><th>Photo</th><th>Status</th></tr></thead>
          <tbody>
            {log.map((r, i) => (
              <tr key={r.id} className={`border-t ${undoable(r) ? "cursor-pointer hover:bg-muted/50" : ""} ${logSel.has(r.id) ? "bg-primary/10" : ""}`} onClick={logClick(r, i)}>
                <td className="w-6">{undoable(r) && <Checkbox checked={logSel.has(r.id)} />}</td>
                <td>{new Date(r.ts).toLocaleString()}</td><td>{actionLabel[r.action] ?? r.action}</td><td>{r.fromName ?? "–"}</td><td>{r.toName ?? "–"}</td>
                <td>{r.distance?.toFixed(2)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {r.action === "hide-group" || r.action === "name-group"
                    ? <a className="text-blue-500 underline" href={`${exImmichUrl}/people/${r.faceId}`} target="_blank" rel="noreferrer">group</a>
                    : r.assetId ? <a className="text-blue-500 underline" href={`${exImmichUrl}/photos/${r.assetId}`} target="_blank" rel="noreferrer">open</a> : null}
                </td>
                <td>{r.ok ? (r.undoneAt ? "undone" : r.action === "delete" ? "deleted (only a snapshot can revert this)" : "ok") : `error: ${r.error}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {view === "review" && mode === "single" && vf && viewIndex !== null && (
        <FaceViewer f={vf} index={viewIndex} count={faces.length} total={total}
          birth={birth ?? current?.birthDate ?? null} exUrl={exImmichUrl}
          group={vf.currentPersonId ? groupsInfo[vf.currentPersonId] : undefined}
          onClose={() => setViewIndex(null)}
          onPrev={() => setViewIndex((i) => (i === null ? i : Math.max(0, i - 1)))}
          onNext={() => setViewIndex((i) => (i === null ? i : Math.min(faces.length - 1, i + 1)))}
          onAssign={() => assignNow(vf)}
          onSecond={() => assignNow(vf, vf.secondPersonId, vf.secondName)}
          onStranger={() => rejectNow(vf)} onNewPerson={async () => { if (await newPersonForFace(vf)) removeFace(vf); }}
          onDelete={() => deleteNow(vf)} onAssignTo={(t) => assignNow(vf, t.id, t.name)} />
      )}
      {pickGroup && (
        <PersonPicker
          suggested={pickGroup.breakdown.map((b) => ({ personId: b.personId, label: `${names[b.personId] ?? "?"} (${b.n} suggestions)` }))}
          onPick={(t) => { const g = pickGroup; setPickGroup(null); applyGroups([g.clusterId], true, t); }}
          onClose={() => setPickGroup(null)} />
      )}
      {view === "review" && mode === "groups" && og && openIdx !== null && (
        <GroupDetail key={og.clusterId} clusterId={og.clusterId} personId={personId} personName={current?.name} names={names}
          birth={current?.birthDate ?? null} exUrl={exImmichUrl} index={openIdx} count={groupTotal} busy={busy} cols={mobile ? 3 : 0}
          onClose={() => { setOpenIdx(null); loadList(groupList.length); }}
          onPrev={() => setOpenIdx((i) => (i === null ? i : Math.max(0, i - 1)))}
          onNext={() => { if (openIdx >= groupList.length - 1 && groupList.length < groupTotal) loadMore(); setOpenIdx((i) => (i === null ? i : Math.min(groupTotal - 1, i + 1))); }}
          onApply={() => applyGroups([og.clusterId], false)} onHide={() => hideGroup(og.clusterId)}
          onApplyTo={(t) => applyGroups([og.clusterId], false, t)} onDeleteGroup={() => deleteGroup(og.clusterId)}
          onName={() => nameGroup(og.clusterId)} onNewPersonFace={newPersonForFace} setMsg={setMsg} />
      )}
      {showBottomBar && <div className="h-16 md:hidden" />}
      {/* Phone: selection actions at the bottom */}
      {showBottomBar && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t bg-background p-2 md:hidden">
          <Button className="h-11 min-w-0 flex-1" disabled={busy} onClick={() => act("apply")}>
            <span className="truncate">{selected.size} {mode === "groups" ? "groups " : ""}→ {current?.name}</span>
          </Button>
          {mode === "single" && (
            <>
              <Button className="h-11" variant="outline" disabled={busy} onClick={() => act("reject")} title="Stranger"><EyeOff className="h-4 w-4" /></Button>
              <Button className="h-11" variant="outline" disabled={busy} onClick={() => act("delete")} title="No face"><Trash2 className="h-4 w-4" /></Button>
            </>
          )}
          <Button className="h-11" variant="outline" onClick={() => setSelected(new Set())} title="Clear selection"><X className="h-4 w-4" /></Button>
        </div>
      )}
      {/* Status / Undo at the bottom, within thumb reach */}
      {toast && (
        <div className={`fixed inset-x-0 z-[70] flex justify-center px-2 ${showBottomBar ? "bottom-16" : "bottom-4"}`}>
          <div className="flex max-w-full items-center gap-3 rounded-lg border bg-background px-4 py-2 text-sm shadow-lg">
            <span className="truncate">{toast.text}</span>
            {toast.undo && <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => { undoLogIds(toast.undo!); setToast(null); }}>Undo</Button>}
            <button onClick={() => setToast(null)} title="Close" className="rounded p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
