import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  createPredefinedBulkRun,
  getLatestPredefinedBulkRun,
  PredefinedBulkError,
} from "@/lib/predefined-bulk/service";

function errorResponse(error: unknown) {
  if (error instanceof PredefinedBulkError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : "Bulk generation failed." }, { status: 500 });
}

async function ownedDocument(documentId: string, userId: string) {
  const doc = await db.query.documents.findFirst({ where: eq(documents.id, documentId) });
  return doc?.ownerId === userId;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await ownedDocument(id, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ run: await getLatestPredefinedBulkRun(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await ownedDocument(id, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({})) as { modelId?: unknown; thinking?: unknown; planHash?: unknown };
  if (typeof body.modelId !== "string" || !body.modelId || typeof body.planHash !== "string" || !body.planHash) {
    return NextResponse.json({ error: "modelId and planHash are required." }, { status: 400 });
  }
  try {
    const run = await createPredefinedBulkRun({
      documentId: id,
      userId: session.user.id,
      modelId: body.modelId,
      thinking: body.thinking !== false,
      planHash: body.planHash,
    });
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
