import { previewSheet } from "@/lib/server/sheetPreview";

// A fixed path: the /api proxy rewrite would otherwise take this request before a dynamic route.
export const POST = (req: Request) => previewSheet(req, "assignments");
