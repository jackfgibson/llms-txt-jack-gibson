import { NextResponse } from "next/server";
import { getOpenApiDocument } from "@/lib/api/openapi";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(getOpenApiDocument());
}
