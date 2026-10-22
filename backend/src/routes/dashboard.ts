import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { DISPOSITION_KEYS } from "../rules/calls.js";
import { cached } from "../services/cache.js";
import * as dash from "../services/dashboard.js";
import { loadSettings } from "../services/settings.js";

/** Everything the three dashboards read. All of it needs a signed-in user, and every number is worked out here, not in the browser. */
export const dashboardRouter = Router();
dashboardRouter.use(requireUser);

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !isNaN(Date.parse(s)), "not a real date");
const RangeQ = z.object({ from: Day, to: Day }).refine((r) => r.from <= r.to, "from must not be after to");
const Ids = z.string().optional().transform((s) => (s ? s.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50) : []));
const Id = z.coerce.number().int().positive();
const Limit = z.coerce.number().int().min(1).max(500).default(50);
const Text = z.string().max(100).default("");

/**
 * Nothing before the start date is ever shown, whatever range is asked for. A range that starts earlier is cut at the
 * start date; a range that lies wholly before it is empty (it is not moved forward onto the first day of data).
 */
async function range(q: unknown): Promise<dash.Range> {
  const r = RangeQ.parse(q);
  const { backfillStart } = await loadSettings();
  if (r.to < backfillStart) return { from: r.from, to: r.to }; // no data exists there, so every answer is empty
  return { from: r.from < backfillStart ? backfillStart : r.from, to: r.to };
}

/** A GET that is answered from the cache when the same question was asked a moment ago. */
const get = (path: string, handler: (req: Request) => Promise<unknown>) =>
  dashboardRouter.get(path, async (req: Request, res: Response) => {
    try {
      const body = await cached(req.originalUrl, () => handler(req));
      if (body === null) return void res.status(404).json({ error: "Not found" });
      res.json(body);
    } catch (e) {
      if (e instanceof z.ZodError) return void res.status(400).json({ error: e.issues[0]?.message ?? "Invalid request" });
      throw e;
    }
  });

get("/meta", () => dash.meta());
get("/overview", async (req) => dash.overview(await range(req.query)));
get("/reps/table", async (req) => dash.repTable(await range(req.query), (await dash.meta()).dateMin));
get("/clients/table", async (req) => dash.clientTable(await range(req.query)));

get("/reps/:id/profile", async (req) => dash.repProfile(Id.parse(req.params.id), await range(req.query), Ids.parse(req.query.clients)));
get("/clients/:id/profile", async (req) => dash.clientProfile(Id.parse(req.params.id), await range(req.query), Ids.parse(req.query.reps)));

const RecQ = z.object({
  q: Text, limit: Limit,
  category: z.enum(["answered", "not_answered"]).optional(),
  sub: z.enum(DISPOSITION_KEYS).optional(),
});
const recordings = (kind: "rep" | "client", filterKey: "clients" | "reps") => async (req: Request) => {
  const o = RecQ.parse(req.query);
  return dash.recordings(kind, Id.parse(req.params.id), {
    range: await range(req.query), filterIds: Ids.parse(req.query[filterKey]), q: o.q, limit: o.limit, category: o.category ?? null, sub: o.category ? (o.sub ?? null) : null,
  });
};
get("/reps/:id/recordings", recordings("rep", "clients"));
get("/clients/:id/recordings", recordings("client", "reps"));

const MailQ = z.object({ q: Text, limit: Limit, filter: z.enum(["all", "opened", "replied", "bounced"]).default("all") });
get("/clients/:id/emails", async (req) => dash.clientEmails(Id.parse(req.params.id), { range: await range(req.query), ...MailQ.parse(req.query) }));
get("/emails/:id", async (req) => dash.emailDetail(z.string().min(1).max(100).parse(req.params.id)));

get("/revenue/weekly", async (req) => dash.revenueWeekly(z.enum(["rep", "client"]).parse(req.query.by), await range(req.query)));

get("/timing/days", async (req) => dash.timingDays(await range(req.query)));
get("/timing/day", async (req) => dash.timingDay(Day.parse(req.query.date)));
get("/timing/week", async (req) => dash.timingWeek(Day.parse(req.query.week), Id.parse(req.query.representative)));
