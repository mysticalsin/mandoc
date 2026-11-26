export type Role = "admin" | "member";

export interface Actor {
  id: string;
  email: string;
  role: Role;
  disabledAt: number | null;
}

export interface Owned {
  ownerId: string;
  deletedAt: number | null;
}

export function isActive(actor: Actor): boolean {
  return actor.disabledAt == null;
}

export function isAdmin(actor: Actor): boolean {
  return isActive(actor) && actor.role === "admin";
}

export function canReadDocument(actor: Actor, document: Owned): boolean {
  if (!isActive(actor) || document.deletedAt != null) return false;
  if (actor.role === "admin") return true;
  return document.ownerId === actor.id;
}

export function canWriteDocument(actor: Actor, document: Owned): boolean {
  return canReadDocument(actor, document);
}

export function canChangeUser(actor: Actor, targetId: string): boolean {
  return isAdmin(actor) && actor.id !== targetId;
}
