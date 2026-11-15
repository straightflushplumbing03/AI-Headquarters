/**
 * GET /api/ai-authority/geolab/status
 *
 * Connection status for the GEO Lab integration, for the admin screen.
 * Authenticated the same way as the rest of the Authority Engine: identity
 * comes from the session cookie and organization membership is verified
 * server-side.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateAuthorityRequest,
  authorityErrorResponse,
  isAuthFailure,
  organizationIdFromRequest,
} from "@/lib/authority/api-auth";
import { getGeoLabStatus } from "@/lib/integrations/geolab/status";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request);
    const auth = await authenticateAuthorityRequest(organizationId);
    if (isAuthFailure(auth)) return auth.response;

    const status = await getGeoLabStatus(auth.supabase, auth.organizationId);
    return NextResponse.json(status);
  } catch (error) {
    return authorityErrorResponse(error, "geolab status");
  }
}
