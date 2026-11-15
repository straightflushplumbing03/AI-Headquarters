/**
 * POST /api/ai-authority/geolab/sync
 *
 * Import research from the GEO Lab. Read-only against the Lab: this pulls
 * data and writes only to our own geo_lab_* tables, so it needs no approval.
 *
 * Requires the `approver` role, because a sync writes rows and consumes the
 * Lab's rate limit. A plain member can view the dashboard but not trigger it.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateAuthorityRequest,
  authorityErrorResponse,
  isAuthFailure,
  organizationIdFromRequest,
  requireApprover,
} from "@/lib/authority/api-auth";
import { syncGeoLab } from "@/lib/integrations/geolab/connector";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // An empty body is valid: the caller may just want the defaults.
    }

    const organizationId = organizationIdFromRequest(request, body);
    const auth = await authenticateAuthorityRequest(organizationId);
    if (isAuthFailure(auth)) return auth.response;

    const denial = requireApprover(auth);
    if (denial) return denial;

    const result = await syncGeoLab(auth.supabase, auth.organizationId, {
      limit: typeof body.limit === "number" ? body.limit : undefined,
      since: typeof body.since === "string" ? body.since : undefined,
    });

    // A failed sync is reported with 200 and an honest status, because the
    // caller renders the outcome. A 5xx would suggest the endpoint is broken,
    // when in fact the endpoint worked and the upstream connection did not.
    return NextResponse.json(result);
  } catch (error) {
    return authorityErrorResponse(error, "geolab sync");
  }
}
