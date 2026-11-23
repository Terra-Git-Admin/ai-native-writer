import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { plotLabFeedback, plotLabMessages, plotLabSessions } from "@/lib/db/schema";
import { authorizePlotLabV2 } from "@/lib/plot-lab-v2/route-support";

type QuestionRating = "up" | "down";

function feedbackResponse(row: typeof plotLabFeedback.$inferSelect) {
  return {
    messageId: row.messageId,
    rating: row.rating as QuestionRating,
    note: row.note ?? undefined,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const { id: documentId } = await params;
  const authorization = await authorizePlotLabV2(session, documentId);
  if (!authorization.ok) return authorization.response;

  const rows = db
    .select({ feedback: plotLabFeedback })
    .from(plotLabFeedback)
    .innerJoin(plotLabSessions, eq(plotLabFeedback.sessionId, plotLabSessions.id))
    .where(
      and(
        eq(plotLabSessions.documentId, documentId),
        eq(plotLabFeedback.createdBy, authorization.userId)
      )
    )
    .orderBy(desc(plotLabFeedback.updatedAt))
    .all();
  const latestByMessage = new Map<string, ReturnType<typeof feedbackResponse>>();
  for (const { feedback } of rows) {
    if (feedback.messageId && !latestByMessage.has(feedback.messageId)) {
      latestByMessage.set(feedback.messageId, feedbackResponse(feedback));
    }
  }
  return NextResponse.json({ feedback: [...latestByMessage.values()] });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const { id: documentId } = await params;
  const authorization = await authorizePlotLabV2(session, documentId);
  if (!authorization.ok) return authorization.response;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  const rating = body?.rating === "up" || body?.rating === "down" ? body.rating : null;
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 1000) : "";
  if (!messageId || !rating) {
    return NextResponse.json({ error: "Choose thumbs up or thumbs down." }, { status: 400 });
  }
  if (rating === "down" && !note) {
    return NextResponse.json({ error: "Add feedback so we know what Levi should improve." }, { status: 400 });
  }

  const target = db
    .select({ message: plotLabMessages, session: plotLabSessions })
    .from(plotLabMessages)
    .innerJoin(plotLabSessions, eq(plotLabMessages.sessionId, plotLabSessions.id))
    .where(
      and(
        eq(plotLabMessages.id, messageId),
        eq(plotLabSessions.documentId, documentId)
      )
    )
    .get();
  if (
    !target ||
    target.message.role !== "levi" ||
    target.message.kind !== "interview_question"
  ) {
    return NextResponse.json({ error: "That Levi question is no longer available." }, { status: 404 });
  }

  const now = new Date();
  const existing = db
    .select()
    .from(plotLabFeedback)
    .where(
      and(
        eq(plotLabFeedback.messageId, messageId),
        eq(plotLabFeedback.createdBy, authorization.userId)
      )
    )
    .orderBy(desc(plotLabFeedback.updatedAt))
    .get();
  if (existing) {
    db.update(plotLabFeedback)
      .set({ rating, note: note || null, updatedAt: now })
      .where(eq(plotLabFeedback.id, existing.id))
      .run();
  } else {
    db.insert(plotLabFeedback)
      .values({
        id: randomUUID(),
        sessionId: target.session.id,
        messageId,
        outputVersion: target.session.latestOutputVersion ?? 0,
        rating,
        note: note || null,
        promptVersionsJson: target.session.promptVersionsJson,
        modelAssignmentsJson: target.session.modelAssignmentsJson,
        trainingPackVersion: target.session.trainingPackVersion,
        createdBy: authorization.userId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const saved = db
    .select()
    .from(plotLabFeedback)
    .where(
      and(
        eq(plotLabFeedback.messageId, messageId),
        eq(plotLabFeedback.createdBy, authorization.userId)
      )
    )
    .orderBy(desc(plotLabFeedback.updatedAt))
    .get()!;
  return NextResponse.json({ feedback: feedbackResponse(saved) });
}
