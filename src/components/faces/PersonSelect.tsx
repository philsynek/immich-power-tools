import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { PersonAvatar } from "./FacePrimitives";
import type { PersonRow } from "./faces.utils";

/** Person dropdown for the header: face, name and count; searchable. */
export function PersonSelect({ people, value, onChange, countLabel }: {
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
