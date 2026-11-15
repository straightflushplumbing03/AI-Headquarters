/**
 * GET  /api/ai-authority/geolab/jobs -- recent job submissions
 * POST /api/ai-authority/geolab/jobs -- submit a job to the GEO Lab
 *
 * This is the two-way half of the integration (spec Phase 6). Submitting
 * requires the `approver` role. The Lab decides what may run: a job that could
 * touch production is returned as `pending_approval` and is not executed. We
 * store the Lab's answer verbatim, so the UI never implies a job ran when it
 * did not.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateAuthorityRequest,
  authorityErrorResponse,
  isAuthFailure,
  organizationIdFromRequest,
  requireApprover,
} from "@/lib/authority/api-auth";
import { listGeoLabJobs, submitGeoLabJob } from "@/lib/integrations/geolab/status";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request);
    const auth = await authenticateAuthorityRequest(organizationId);
    if (isAuthFailure(auth)) return auth.response;

    const jobs = await listGeoLabJobs(auth.supabase, auth.organizationId);
    return NextResponse.json({ jobs });
  } catch (error) {
    return authorityErrorResponse(error, "geolab jobs list");
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const organizationId = organizationIdFromRequest(request, body);
    const auth = await authenticateAuthorityRequest(organizationId);
    if (isAuthFailure(auth)) return auth.response;

    const denial = requireApprover(auth);
    if (denial) return denial;

    const kind = typeof body.kind === "string" ? body.kind : "";
    if (!kind) return NextResponse.json({ error: "kind is required." }, { status: 400 });

    const result = await submitGeoLabJob(auth.supabase, auth.organizationId, {
      kind,
      params: (body.params as Record<string, unknown>) ?? {},
      requestedBy: `AI Headquarters (${auth.userId})`,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (error) {
    return authorityErrorResponse(error, "geolab job submit");
  }
}
