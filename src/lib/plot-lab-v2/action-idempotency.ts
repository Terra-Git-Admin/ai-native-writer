import { createHash } from "node:crypto";
import type { PlotLabAction, PlotLabActionEnvelope } from "@/lib/plot-lab-v2/contracts";

export interface PlotLabActionRequestScope {
  documentId: string;
  userId: string;
}

export function isPlotLabActionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function getPlotLabActionKind(action: PlotLabAction): PlotLabAction["kind"] {
  return action.kind;
}

export function hashPlotLabActionRequest(
  scope: PlotLabActionRequestScope,
  envelope: PlotLabActionEnvelope
): string {
  const normalized = stableStringify({
    documentId: scope.documentId,
    userId: scope.userId,
    expectedRevision: envelope.expectedRevision,
    action: envelope.action,
  });
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
