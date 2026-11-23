import * as facesApi from "@/handlers/api/faces.handler";
import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { PersonAvatar } from "./FacePrimitives";
import type { NamedPerson } from "./faces.utils";

let personsCache: NamedPerson[] | null = null;
/** Forget the cached people list (after a person was created or named). */
export const resetPersonsCache = () => { personsCache = null; };
export interface PickTarget { id: string; name: string }

/** "Assign to…": searchable list of all named people; suggested people first. */
export function PersonPicker({ suggested, onPick, onClose }: {
  suggested?: { personId: string; label: string }[]; onPick: (t: PickTarget) => void; onClose: () => void;
}) {
  const [all, setAll] = useState<NamedPerson[]>(personsCache ?? []);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (personsCache) return;
    facesApi.listNamedPeople().then((data) => { personsCache = data; setAll(data); }).catch(() => { /* picker stays empty */ });
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
