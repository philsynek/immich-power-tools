import * as facesApi from "@/handlers/api/faces.handler";
import React, { useCallback, useEffect, useRef, useState } from "react";
import PageLayout from "@/components/layouts/PageLayout";
import Header from "@/components/shared/Header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfig } from "@/contexts/ConfigContext";
import { EyeOff, Trash2, Users, X } from "lucide-react";
import { SortControl } from "./FacePrimitives";
import { FaceTile, GroupTile } from "./FaceTile";
import { FaceViewer } from "./FaceViewer";
import { GroupDetail } from "./GroupDetail";
import { PersonPicker, resetPersonsCache } from "./PersonPicker";
import type { PickTarget } from "./PersonPicker";
import { PersonSelect } from "./PersonSelect";
import { DATE_LABEL, GROUP_PAGE, ORIGIN_LABEL, PAGE, SIZES, loadSort, saveSort, sortHint, tileFor, useElementWidth, useViewportWidth } from "./faces.utils";
import type { DateMode, Face, GroupInfo, GroupRow, LogRow, Mode, Origin, PersonRow, Size, SortState } from "./faces.utils";

export default function UnnamedFaces() {
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
    const data = await facesApi.listFacePeople();
    setPeople(data);
    setPersonId((p) => p || data[0]?.personId || "");
  }, []);
  /** Reload the current list (faces or groups). Keeps selection for items still listed. Returns the new length. */
  const loadList = useCallback(async (count?: number, forceSync = false): Promise<number> => {
    if (!personId) { setFaces([]); setTotal(0); setGroupList([]); setGroupTotal(0); return 0; }
    if (mode === "groups") {
      const data = await facesApi.listFaceGroups({ personId, sort: sortGroups.key, dir: sortGroups.dir, limit: count || GROUP_PAGE, offset: 0, sync: forceSync ? 1 : undefined });
      const ids = new Set<string>((data.groups as GroupRow[]).map((g) => g.clusterId));
      setGroupList(data.groups); setGroupTotal(data.total); setNames((n) => ({ ...n, ...data.names }));
      setSelected((prev) => new Set(Array.from(prev).filter((id) => ids.has(id))));
      return data.groups.length;
    }
    const data = await facesApi.listFaceSuggestions({ personId, dateMode, origin, sort: sortSingle.key, dir: sortSingle.dir, limit: count || PAGE, offset: 0, sync: forceSync ? 1 : undefined });
    const ids = new Set<string>((data.faces as Face[]).map((f) => f.faceId));
    setFaces(data.faces); setTotal(data.total); setBirth(data.birthDate); setGroupsInfo(data.groups); setNames((n) => ({ ...n, ...data.names }));
    setSelected((prev) => new Set(Array.from(prev).filter((id) => ids.has(id))));
    return data.faces.length;
  }, [mode, personId, dateMode, origin, sortSingle, sortGroups]);
  const loadMore = async () => {
    if (mode === "groups") {
      const data = await facesApi.listFaceGroups({ personId, sort: sortGroups.key, dir: sortGroups.dir, limit: GROUP_PAGE, offset: groupList.length });
      const known = new Set(groupList.map((g) => g.clusterId));
      setGroupList((prev) => [...prev, ...(data.groups as GroupRow[]).filter((g) => !known.has(g.clusterId))]); setGroupTotal(data.total);
      setNames((n) => ({ ...n, ...data.names }));
    } else {
      const data = await facesApi.listFaceSuggestions({ personId, dateMode, origin, sort: sortSingle.key, dir: sortSingle.dir, limit: PAGE, offset: faces.length });
      const known = new Set(faces.map((f) => f.faceId));
      setFaces((prev) => [...prev, ...(data.faces as Face[]).filter((f) => !known.has(f.faceId))]); setTotal(data.total);
      setGroupsInfo((g) => ({ ...g, ...data.groups })); setNames((n) => ({ ...n, ...data.names }));
    }
  };
  const loadLog = useCallback(async () => {
    const data = await facesApi.listFaceLog();
    setLog(data); setLogSel(new Set()); lastLogIndex.current = null;
  }, []);
  const loadScan = useCallback(async () => { const data = await facesApi.getFaceScan(); setScan(data); return data; }, []);

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
      const data = await facesApi.applyFaces([f.faceId], to);
      const r = data.results?.[0];
      if (!r?.ok) { setMsg(`Error: ${r?.error ?? "unknown"}`); loadList(faces.length); }
      else setMsg(`Assigned → ${targetName ?? f.suggestedName ?? ""}`, r.logId ? [r.logId] : undefined);
    } catch (e: any) { setMsg(facesApi.faceApiError(e)); loadList(faces.length); }
  };
  const deleteNow = async (f: Face) => {
    removeFace(f);
    try {
      const data = await facesApi.deleteFaces([f.faceId]);
      const r = data.results?.[0];
      if (!r?.ok) { setMsg(`Delete failed: ${r?.error ?? "unknown"}`); loadList(faces.length); } else setMsg("Face detection deleted");
    } catch (e: any) { setMsg(facesApi.faceApiError(e)); loadList(faces.length); }
  };
  const rejectNow = async (f: Face) => {
    removeFace(f);
    try { const data = await facesApi.rejectFaces([f.faceId]); setMsg("Hidden as stranger", data.logIds); }
    catch (e: any) { setMsg(facesApi.faceApiError(e)); loadList(faces.length); }
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
      const data = await facesApi.applyFaceGroups(clusterIds, to.id);
      const bad = (data.results as any[]).filter((r) => !r.ok);
      const undoIds = (data.results as any[]).filter((r) => r.ok && r.logId).map((r) => r.logId as number);
      setMsg(`${data.results.length - bad.length} faces → ${to.name}${data.skipped ? `, ${data.skipped} excluded skipped` : ""}${bad.length ? `, ${bad.length} errors: ${bad[0].error}` : ""}`, undoIds);
      await afterGroupAction();
    } catch (e: any) { setMsg(facesApi.faceApiError(e)); }
    setBusy(false);
  };
  const hideGroup = async (clusterId: string) => {
    setBusy(true);
    try {
      const data = await facesApi.hideFaceGroup(clusterId);
      setMsg("Group hidden (also in Immich)", data.logId ? [data.logId] : undefined);
      await afterGroupAction();
    } catch (e: any) { setMsg(`Hiding failed: ${facesApi.faceApiError(e)}`); }
    setBusy(false);
  };
  /** "No face" for a whole group – irreversible from the tool, so ask with a clear warning. */
  /** Confirmation happens in the group detail's warning dialog. */
  const deleteGroup = async (clusterId: string) => {
    setBusy(true); setMsg("Deleting face detections …");
    try {
      const data = await facesApi.deleteFaceGroup(clusterId);
      setMsg(`${data.deleted} face detections deleted${data.skipped ? `, ${data.skipped} excluded kept` : ""}${data.errors ? `, ${data.errors} errors: ${data.error}` : ""}`);
      await afterGroupAction();
    } catch (e: any) { setMsg(facesApi.faceApiError(e)); }
    setBusy(false);
  };
  /** Give an unnamed group a name in Immich; it then becomes a named person and leaves the list. */
  const nameGroup = async (clusterId: string) => {
    const name = window.prompt("Name for this group (creates a named person in Immich):")?.trim();
    if (!name) return;
    setBusy(true);
    try {
      const data = await facesApi.nameFaceGroup(clusterId, name);
      resetPersonsCache(); // the new person must show up in "Assign to…"
      setMsg(`Group named "${name}"`, data.logId ? [data.logId] : undefined);
      await afterGroupAction(); await loadPeople();
    } catch (e: any) { setMsg(`Naming failed: ${facesApi.faceApiError(e)}`); }
    setBusy(false);
  };
  /** "New person" for a single face: creates a named person in Immich and assigns the face to it. */
  const newPersonForFace = async (f: Face): Promise<boolean> => {
    const name = window.prompt("Name of the new person:")?.trim();
    if (!name) return false;
    try {
      const data = await facesApi.createPersonForFace(f.faceId, name);
      resetPersonsCache();
      setMsg(`New person "${name}" created`, data.logId ? [data.logId] : undefined);
      loadPeople();
      return true;
    } catch (e: any) { setMsg(`Failed: ${facesApi.faceApiError(e)}`); return false; }
  };
  const undoLogIds = async (ids: number[]) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const data = await facesApi.undoFaceActions(ids);
      const bad = (data.results as any[]).filter((r) => !r.ok);
      const loose = data.results.filter((r) => r.ok && r.note).length;
      setMsg(`${ids.length - bad.length} undone${loose ? ` (${loose} back as loose faces: original group no longer exists)` : ""}${bad.length ? `, ${bad.length} errors: ${bad[0].error}` : ""}`);
    } catch (e: any) { setMsg(facesApi.faceApiError(e)); }
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
      const data: any = kind === "apply" ? await facesApi.applyFaces(ids) : kind === "reject" ? await facesApi.rejectFaces(ids) : await facesApi.deleteFaces(ids);
      if (kind === "reject") setMsg(`${ids.length} hidden as strangers`, data.logIds);
      else {
        const bad = (data.results as any[]).filter((r) => !r.ok);
        const undoIds = kind === "apply" ? (data.results as any[]).filter((r) => r.ok && r.logId).map((r) => r.logId as number) : [];
        setMsg(`${ids.length - bad.length} ${kind === "apply" ? "assigned" : "deleted"}${bad.length ? `, ${bad.length} errors: ${bad[0].error}` : ""}`, undoIds);
      }
      await loadList(faces.length); await loadPeople();
    } catch (e: any) { setMsg(facesApi.faceApiError(e)); }
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
          <Button variant="outline" size="sm" disabled={scan?.running} onClick={async () => { await facesApi.startFaceScan(false); loadScan(); }}>
            {scan?.running ? `Scanning … ${scan.scanned} checked, ${scan.stored} suggestions` : "Start / resume scan"}
          </Button>
          <Button variant="outline" size="sm" className="hidden md:inline-flex" disabled={scan?.running} onClick={async () => { if (confirm("Discard open suggestions and scan again from scratch?")) { await facesApi.startFaceScan(true); loadScan(); } }}>
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
                  {mode === "groups" ? "Shift+click: range · ⤢ opens a group to review its faces one by one" : "Shift+click: range · icon top left = face belongs to a group"}
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
            <Button onClick={async () => { await facesApi.startFaceScan(false); loadScan(); }}>Start scan</Button>
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
                <td>{r.ok ? (r.undoneAt ? "undone" : r.action === "delete" ? "deleted (only a snapshot can revert this)" : r.error ? `ok · ${r.error}` : "ok") : `error: ${r.error}`}</td>
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
