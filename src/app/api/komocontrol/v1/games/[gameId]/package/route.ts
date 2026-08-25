import { downloadScorerGamePackage, gamePackageDownloadErrorResponse } from "@/services/komocontrol-game-package-download.service";
import { resolveScorerSession, scorerAuthErrorResponse, scorerAuthSuccess } from "@/services/komocontrol-scorer-auth.service";

export async function GET(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  try {
    const session = await resolveScorerSession(request);
    const { gameId } = await params;
    return scorerAuthSuccess(await downloadScorerGamePackage(session.organization.id, gameId));
  } catch (error) {
    return gamePackageDownloadErrorResponse(error) ?? scorerAuthErrorResponse(error);
  }
}
