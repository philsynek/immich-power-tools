import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ASSET_PREVIEW_PATH, PERSON_THUBNAIL_PATH } from "@/config/routes";
import { AvatarFallback, AvatarImage, AvatarRoot } from "@/components/ui/avatar";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { SORTS, sortHint } from "./faces.utils";
import type { Mode, SortState } from "./faces.utils";

/** Sort dropdown + direction toggle. */
export function SortControl({ mode, value, onChange }: { mode: Mode; value: SortState; onChange: (v: SortState) => void }) {
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


/** Face crop as CSS background (from Immich preview + bounding box). */
export function FaceCrop({ assetId, box, size, onClick, onLongPress, title, className, children }: {
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
      width: size, height: size, backgroundImage: `url(${ASSET_PREVIEW_PATH(assetId)})`,
      backgroundSize: `${bgW}px ${bgH}px`, backgroundPosition: `${left}px ${top}px`, backgroundRepeat: "no-repeat",
    }}>{children}</div>
  );
}

/** Small "delete" button with a second confirming click. */
export function DeleteButton({ onDelete, big }: { onDelete: () => void; big?: boolean }) {
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
export function PersonAvatar({ id, name, className }: { id: string; name?: string; className?: string }) {
  return (
    <AvatarRoot className={className ?? "h-7 w-7"}>
      <AvatarImage src={PERSON_THUBNAIL_PATH(id)} alt={name ?? ""} className="object-cover" />
      <AvatarFallback className="text-xs">{(name ?? "?").slice(0, 1).toUpperCase()}</AvatarFallback>
    </AvatarRoot>
  );
}


/** Warning dialog for irreversible actions. Confirm with Del (again) or the red button; Enter does nothing on purpose. */
export function DangerConfirm({ title, children, confirmLabel, onConfirm, onCancel }: {
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
