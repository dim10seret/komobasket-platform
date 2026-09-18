import { requirePlatformSuperAdminRequest } from "@/lib/admin-auth";
import { newsApiError } from "@/lib/news-api";
import { deleteNewsAsset, storeNewsAsset } from "@/lib/news-assets";
import { createNewsAttachment } from "@/services/news.service";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const MAX_ATTACHMENT_SIZE = 15 * 1024 * 1024;
const allowedFileTypes = new Map([
  ["application/pdf", "pdf"],
  ["application/msword", "doc"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx",
  ],
  ["application/vnd.ms-excel", "xls"],
  [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xlsx",
  ],
]);

function cleanFilename(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim();
}

export async function POST(request: Request, context: RouteContext) {
  const authorization = await requirePlatformSuperAdminRequest(request);
  if (authorization.response) return authorization.response;

  try {
    const { id } = await context.params;
    const formData = await request.formData();
    const file = formData.get("file");
    const requestedName = formData.get("name");

    if (!(file instanceof File)) {
      return Response.json({ error: "Δεν επιλέχθηκε αρχείο." }, { status: 400 });
    }

    const extension = allowedFileTypes.get(file.type);
    if (!extension || file.size > MAX_ATTACHMENT_SIZE || file.size === 0) {
      return Response.json(
        {
          error:
            "Επιτρέπονται αρχεία PDF, Word και Excel έως 15 MB το καθένα.",
        },
        { status: 400 },
      );
    }

    const originalName =
      cleanFilename(file.name) || `συνημμένο.${extension}`;
    const displayName =
      typeof requestedName === "string" && requestedName.trim()
        ? requestedName.trim().slice(0, 160)
        : originalName.replace(/\.[^.]+$/, "");
    const storageKey = `news/${id}/attachments/${crypto.randomUUID()}.${extension}`;

    await storeNewsAsset(storageKey, await file.arrayBuffer(), file.type);
    let attachment;
    try {
      attachment = await createNewsAttachment(id, {
        name: displayName,
        originalName,
        storageKey,
        contentType: file.type,
        size: file.size,
      });
    } catch (error) {
      await deleteNewsAsset(storageKey);
      throw error;
    }

    return Response.json({ attachment }, { status: 201 });
  } catch (error) {
    return newsApiError(error);
  }
}
