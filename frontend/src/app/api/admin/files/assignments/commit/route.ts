import { commitSheet } from "@/lib/server/sheetCommit";

// A fixed path: the /api proxy rewrite would otherwise take this request before a dynamic route.
export const POST = (req: Request) => commitSheet(req, "assignments");
