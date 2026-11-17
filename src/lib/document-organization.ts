type DocumentOrientation = "portrait" | "landscape";

function isDocumentOrientation(value: unknown): value is DocumentOrientation {
  return value === "portrait" || value === "landscape";
}

export type DocumentOrganizationChanges = {
  folderId?: string | null;
  orientation?: DocumentOrientation;
  archivedAt?: Date | null;
};

const RESERVED_FOLDER_NAMES = new Set(["all", "archived"]);

export function normalizeFolderName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function cleanFolderName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function validateFolderName(value: unknown):
  | { ok: true; name: string; normalizedName: string }
  | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "Folder name is required." };
  }

  const name = cleanFolderName(value);
  if (!name) return { ok: false, error: "Folder name is required." };
  if (name.length > 80) {
    return { ok: false, error: "Folder names must be 80 characters or fewer." };
  }

  const normalizedName = normalizeFolderName(name);
  if (RESERVED_FOLDER_NAMES.has(normalizedName)) {
    return {
      ok: false,
      error: `“${name}” is a system view. Choose another folder name.`,
    };
  }

  return { ok: true, name, normalizedName };
}

export function parseOrganizationChanges(value: unknown):
  | { ok: true; changes: DocumentOrganizationChanges }
  | { ok: false; error: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Organization changes are required." };
  }

  const body = value as Record<string, unknown>;
  const changes: DocumentOrganizationChanges = {};

  if (Object.prototype.hasOwnProperty.call(body, "folderId")) {
    if (body.folderId !== null && typeof body.folderId !== "string") {
      return { ok: false, error: "folderId must be a string or null." };
    }
    changes.folderId = body.folderId as string | null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "orientation")) {
    if (!isDocumentOrientation(body.orientation)) {
      return {
        ok: false,
        error: "orientation must be portrait or landscape.",
      };
    }
    changes.orientation = body.orientation;
  }

  if (Object.prototype.hasOwnProperty.call(body, "archived")) {
    if (typeof body.archived !== "boolean") {
      return { ok: false, error: "archived must be a boolean." };
    }
    changes.archivedAt = body.archived ? new Date() : null;
  }

  if (Object.keys(changes).length === 0) {
    return { ok: false, error: "At least one organization change is required." };
  }

  return { ok: true, changes };
}
