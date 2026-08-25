import { logoutScorer, scorerAuthErrorResponse, scorerAuthSuccess } from "@/services/komocontrol-scorer-auth.service";

export async function POST(request: Request) {
  try {
    await logoutScorer(request);
    return scorerAuthSuccess({ revoked: true });
  } catch (error) {
    return scorerAuthErrorResponse(error);
  }
}
