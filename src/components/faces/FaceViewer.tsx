import React, { useEffect, useState } from "react";
import { ASSET_PREVIEW_PATH } from "@/config/routes";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ExternalLink, EyeOff, PenLine, Trash2, UserPlus, Users, X } from "lucide-react";
import { PersonPicker } from "./PersonPicker";
import type { PickTarget } from "./PersonPicker";
import { ageAt, fmtD, fmtDate, useSwipe } from "./faces.utils";
import type { Face, GroupInfo } from "./faces.utils";

export interface ViewerProps {
  f: Face; index: number; count: number; total: number; birth: string | null; exUrl: string; group?: GroupInfo;
  onClose: () => void; onPrev: () => void; onNext: () => void;
  onAssign: () => void; onSecond: () => void; onStranger: () => void; onDelete: () => void;
  onAssignTo: (t: PickTarget) => void; onNewPerson: () => void;
}
/** Full-photo overlay with the face outlined.
 * Keys: Enter suggestion · 2 runner-up · A assign to… · S stranger · N new person · Del 2× no face · ←/→ · Esc. */
export function FaceViewer(p: ViewerProps) {
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
          <img key={f.assetId} src={ASSET_PREVIEW_PATH(f.assetId)} alt="" className="block max-h-[62vh] max-w-[96vw] object-contain md:max-h-[70vh] md:max-w-[80vw]" />
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
