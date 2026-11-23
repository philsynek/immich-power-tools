import {
  FACES_APPLY_GROUP_PATH, FACES_APPLY_PATH, FACES_DELETE_GROUP_PATH, FACES_DELETE_PATH, FACES_EXCLUDE_PATH,
  FACES_GROUPS_PATH, FACES_HIDE_GROUP_PATH, FACES_LOG_PATH, FACES_NAME_GROUP_PATH, FACES_NAMED_PEOPLE_PATH,
  FACES_NEW_PERSON_PATH, FACES_PEOPLE_PATH, FACES_REJECT_PATH, FACES_SCAN_PATH, FACES_SUGGESTIONS_PATH, FACES_UNDO_PATH,
} from "@/config/routes";
import API from "@/lib/api";
import type {
  IFaceActionResult, IFaceGroupsResponse, IFaceLogRow, IFaceScanProgress, IFaceSuggestionsQuery, IFaceSuggestionsResponse,
  IFacesNamedPerson, IFacesPersonRow,
} from "@/types/faces";

type Paging = { limit?: number; offset?: number; sync?: 1 };

export const listFacePeople = (params: { sync?: 1 } = {}): Promise<IFacesPersonRow[]> => API.get(FACES_PEOPLE_PATH, params);
export const listNamedPeople = (): Promise<IFacesNamedPerson[]> => API.get(FACES_NAMED_PEOPLE_PATH);
export const listFaceSuggestions = (params: Partial<IFaceSuggestionsQuery> & Paging): Promise<IFaceSuggestionsResponse> =>
  API.get(FACES_SUGGESTIONS_PATH, params);
export const listFaceGroups = (params: { personId: string; sort?: string; dir?: string } & Paging): Promise<IFaceGroupsResponse> =>
  API.get(FACES_GROUPS_PATH, params);
export const listFaceLog = (): Promise<IFaceLogRow[]> => API.get(FACES_LOG_PATH);

export const getFaceScan = (): Promise<IFaceScanProgress> => API.get(FACES_SCAN_PATH);
export const startFaceScan = (reset = false): Promise<IFaceScanProgress> => API.post(FACES_SCAN_PATH, { reset });

export const applyFaces = (faceIds: string[], personId?: string | null): Promise<{ results: IFaceActionResult[] }> =>
  API.post(FACES_APPLY_PATH, { faceIds, personId: personId || undefined });
export const applyFaceGroups = (clusterIds: string[], personId: string): Promise<{ results: IFaceActionResult[]; skipped: number }> =>
  API.post(FACES_APPLY_GROUP_PATH, { clusterIds, personId });
export const rejectFaces = (faceIds: string[]): Promise<{ ok: boolean; logIds: number[] }> => API.post(FACES_REJECT_PATH, { faceIds });
export const excludeFaces = (faceIds: string[], include = false): Promise<{ ok: boolean }> =>
  API.post(FACES_EXCLUDE_PATH, { faceIds, include });
export const deleteFaces = (faceIds: string[]): Promise<{ results: IFaceActionResult[] }> => API.post(FACES_DELETE_PATH, { faceIds });
export const deleteFaceGroup = (clusterId: string): Promise<{ deleted: number; skipped: number; errors: number; error: string | null }> =>
  API.post(FACES_DELETE_GROUP_PATH, { clusterId });
export const hideFaceGroup = (clusterId: string): Promise<{ ok: boolean; error: string | null; logId: number | null }> =>
  API.post(FACES_HIDE_GROUP_PATH, { clusterId });
export const nameFaceGroup = (clusterId: string, name: string): Promise<{ ok: boolean; error: string | null; logId: number | null }> =>
  API.post(FACES_NAME_GROUP_PATH, { clusterId, name });
export const createPersonForFace = (faceId: string, name: string): Promise<IFaceActionResult & { personId: string }> =>
  API.post(FACES_NEW_PERSON_PATH, { faceId, name });
export const undoFaceActions = (logIds: number[]): Promise<{ results: { logId: number; ok: boolean; error?: string; note?: string }[]; ok: boolean; error?: string }> =>
  API.post(FACES_UNDO_PATH, { logIds });

/** Readable message from a rejected API call (the API helper rejects with { error, message, status }). */
export const faceApiError = (e: any): string => e?.message || e?.error || String(e);
