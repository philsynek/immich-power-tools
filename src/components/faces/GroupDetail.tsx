import * as facesApi from "@/handlers/api/faces.handler";
import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ExternalLink, EyeOff, PenLine, Trash2, UserPlus, Users, X } from "lucide-react";
import { DangerConfirm } from "./FacePrimitives";
import { FaceTile } from "./FaceTile";
import { FaceViewer } from "./FaceViewer";
import { PersonPicker } from "./PersonPicker";
import type { PickTarget } from "./PersonPicker";
import { SIZES, breakdownText, tileFor, useElementWidth, useSwipe } from "./faces.utils";
import type { Face, GroupInfo } from "./faces.utils";

/** Group detail: all faces of one unnamed group, with stranger, runner-up, delete and the photo viewer. */
export function GroupDetail({ clusterId, personName, names: initialNames, birth, exUrl, index, count, busy, cols,
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
    const data = await facesApi.listFaceSuggestions({ clusterId, personId, limit: 1000 });
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
    try { await facesApi.excludeFaces([f.faceId], !value); }
    catch (e: any) { setMsg(facesApi.faceApiError(e)); load(); }
  };
  const assign = async (f: Face, to?: string | null, toName?: string | null) => {
    const target = to || f.suggestedPersonId;
    if (!target) return setMsg("No suggestion for this face");
    remove(f);
    try {
      const data = await facesApi.applyFaces([f.faceId], target);
      const r = data.results?.[0];
      if (r?.ok) setMsg(`Assigned → ${toName ?? f.suggestedName ?? ""}`, r.logId ? [r.logId] : undefined);
      else { setMsg(`Error: ${r?.error ?? "unknown"}`); load(); }
    } catch (e: any) { setMsg(facesApi.faceApiError(e)); load(); }
  };
  const stranger = async (f: Face) => {
    remove(f);
    try {
      const data = await facesApi.rejectFaces([f.faceId]);
      setMsg("Hidden as stranger", data.logIds);
    }
    catch (e: any) { setMsg(facesApi.faceApiError(e)); load(); }
  };
  const newPerson = async (f: Face) => { if (await onNewPersonFace(f)) remove(f); };
  const del = async (f: Face) => {
    remove(f);
    try {
      const data = await facesApi.deleteFaces([f.faceId]);
      if (!data.results?.[0]?.ok) { setMsg(`Delete failed: ${data.results?.[0]?.error ?? "unknown"}`); load(); }
    } catch (e: any) { setMsg(facesApi.faceApiError(e)); load(); }
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
