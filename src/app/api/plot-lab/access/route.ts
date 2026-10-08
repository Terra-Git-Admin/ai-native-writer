import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPlotLabAccess } from "@/lib/plot-lab/access";

export async function GET(req: Request) {
  const session = await auth();
  const url = new URL(req.url);
  const documentId = url.searchParams.get("documentId");
  const access = await getPlotLabAccess(session, { documentId });

  return NextResponse.json(access);
}
