/** Unnamed Faces: review unnamed and hidden faces and unnamed groups against known people. */

export type IFaceDateMode = "all" | "hidePre" | "onlyPre";
export type IFaceOrigin = "all" | "group" | "loose";
export type IFaceSortDir = "asc" | "desc";

export interface IFaceScanProgress {
  running: boolean;
  scanned: number;
  stored: number;
  done: boolean;
  error?: string;
  startedAt?: string;
  updatedAt?: string | null;
}

/** Named person with open suggestions (left-hand list). */
export interface IFacesPersonRow {
  personId: string;
  name: string;
  birthDate: string | null;
  total: number;
  loose: number;
  groups: number;
}

/** Named person for the "Assign to…" picker. */
export interface IFacesNamedPerson { id: string; name: string; hidden: boolean }

export interface IFaceBox { w: number; h: number; x1: number; y1: number; x2: number; y2: number }

export interface IFace extends IFaceBox {
  faceId: string;
  assetId: string;
  distance: number | null;
  excluded?: boolean | number;
  suggestedPersonId: string | null;
  suggestedName: string | null;
  secondPersonId: string | null;
  secondName: string | null;
  secondDistance: number | null;
  currentPersonId: string | null;
  capturedAt: string | null;
}

export interface IFaceGroupInfo { size: number; breakdown: { personId: string; n: number }[] }

export interface IFaceGroup {
  clusterId: string;
  size: number;
  majority: number;
  withSuggestion: number;
  excluded: number;
  noSuggestion: number;
  breakdown: { personId: string; n: number }[];
  rep: (IFaceBox & { faceId: string; assetId: string; distance: number; capturedAt: string | null }) | null;
}

export interface IFaceGroupsResponse { total: number; groups: IFaceGroup[]; names: Record<string, string> }

export interface IFaceSuggestionsQuery {
  personId?: string;
  clusterId?: string;
  dateMode?: IFaceDateMode;
  origin?: IFaceOrigin;
  sort?: string;
  dir?: IFaceSortDir;
  limit: number;
  offset: number;
}

export interface IFaceSuggestionsResponse {
  birthDate: string | null;
  total: number;
  cluster: { exists: boolean; name: string } | null;
  names: Record<string, string>;
  groups: Record<string, IFaceGroupInfo>;
  faces: IFace[];
}

export interface IFaceLogRow {
  id: number;
  ts: string;
  action: string;
  faceId: string;
  assetId: string | null;
  fromPersonId: string | null;
  toPersonId: string | null;
  fromName: string | null;
  toName: string | null;
  distance: number | null;
  ok: number;
  error: string | null;
  undoneAt: string | null;
}

export interface IFaceActionResult { faceId: string; ok: boolean; error?: string; logId?: number }
