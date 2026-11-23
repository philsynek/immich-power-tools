import React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { EyeOff, Maximize2, UserPlus, Users } from "lucide-react";
import { DeleteButton, FaceCrop } from "./FacePrimitives";
import { ageAt, breakdownText, fmtD, fmtDate } from "./faces.utils";
import type { Face, GroupInfo, GroupRow } from "./faces.utils";

export interface TileProps {
  f: Face; birth: string | null; selected: boolean; oneClick: boolean; size: number; group?: GroupInfo; inGroupDetail?: boolean;
  onImageClick: (e: React.MouseEvent) => void; onToggle?: () => void; onSecond: () => void; onDelete: () => void; onView: () => void;
  onStranger?: () => void; onInclude?: () => void; onLongPress?: () => void;
}
export function FaceTile({ f, birth, selected, oneClick, size, group, inGroupDetail, onImageClick, onToggle, onSecond, onDelete, onView, onStranger, onInclude, onLongPress }: TileProps) {
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

export function GroupTile({ g, names, selected, size, onToggle, onOpen, onHide, onLongPress, onAssignTo }: {
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
