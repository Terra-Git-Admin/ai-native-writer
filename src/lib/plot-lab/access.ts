import type { Session } from "next-auth";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, users } from "@/lib/db/schema";

export type PlotLabAccessReason =
  | "admin"
  | "user_enabled"
  | "release_disabled"
  | "stage2_disabled"
  | "unauthenticated"
  | "inactive_user"
  | "user_not_allowed"
  | "document_required"
  | "document_not_found"
  | "document_forbidden";

export interface PlotLabAccess {
  canUsePlotLab: boolean;
  canUsePlotLabTesterTools: boolean;
  reason: PlotLabAccessReason;
}

export const PLOT_LAB_STAGE_1_MODES = new Set<string>([
  "plot_lab_chat",
  "plot_lab_source_soul_scan",
  "plot_lab_character_analyst",
  "plot_lab_continuity_audit",
  "plot_lab_paywall_architect",
  "plot_lab_premise_bridge",
  "plot_lab_universe_builder",
  "plot_lab_save_preview",
]);

export const PLOT_LAB_STAGE_2_MODES = new Set<string>([
  "plot_lab_runway_sketch",
  "plot_lab_final_plot",
]);

export function isPlotLabPrivateReleaseEnabled(): boolean {
  return process.env.PLOT_LAB_PRIVATE_RELEASE_ENABLED === "true";
}

export function isPlotLabStage2Enabled(): boolean {
  return process.env.PLOT_LAB_STAGE2_ENABLED === "true";
}

export function isPlotLabMode(mode: string): boolean {
  return PLOT_LAB_STAGE_1_MODES.has(mode) || PLOT_LAB_STAGE_2_MODES.has(mode);
}

export function isPlotLabStage2Mode(mode: string): boolean {
  return PLOT_LAB_STAGE_2_MODES.has(mode);
}

export async function getPlotLabAccess(
  session: Session | null | undefined,
  options: { documentId?: string | null } = {}
): Promise<PlotLabAccess> {
  if (!session?.user?.id) {
    return blocked("unauthenticated");
  }
  if (!isPlotLabPrivateReleaseEnabled()) {
    return blocked("release_disabled");
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: {
      id: true,
      role: true,
      active: true,
      plotLabAccess: true,
    },
  });

  if (!user?.active) {
    return blocked("inactive_user");
  }

  const isAdmin = user.role === "admin";
  const hasUserAccess = isAdmin || user.plotLabAccess;
  if (!hasUserAccess) {
    return blocked("user_not_allowed");
  }

  if (options.documentId) {
    const doc = await db.query.documents.findFirst({
      where: eq(documents.id, options.documentId),
      columns: { ownerId: true },
    });
    if (!doc) {
      return blocked("document_not_found");
    }
    if (!isAdmin && doc.ownerId !== user.id) {
      return blocked("document_forbidden");
    }
  }

  return {
    canUsePlotLab: true,
    canUsePlotLabTesterTools: true,
    reason: isAdmin ? "admin" : "user_enabled",
  };
}

function blocked(reason: PlotLabAccessReason): PlotLabAccess {
  return {
    canUsePlotLab: false,
    canUsePlotLabTesterTools: false,
    reason,
  };
}
