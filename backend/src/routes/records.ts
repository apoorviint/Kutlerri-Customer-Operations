import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db.js";
import { requireUser } from "../auth.js";

export const recordsRouter = Router();

const Paging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});

const Calls = Paging.extend({
  agent: z.string().max(200).optional(),
  q: z.string().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

recordsRouter.get("/calls", requireUser, async (req, res) => {
  const p = Calls.safeParse(req.query);
  if (!p.success) return void res.status(400).json({ error: "Invalid query" });
  const { page, perPage, agent, q, from, to } = p.data;

  const where: Prisma.CallWhereInput = {
    ...(agent && { agentName: agent }),
    ...(q && { OR: [{ contactNo: { contains: q } }, { agentName: { contains: q, mode: "insensitive" } }] }),
    ...((from || to) && {
      startedAt: {
        ...(from && { gte: new Date(`${from}T00:00:00Z`) }),
        ...(to && { lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000) }),
      },
    }),
  };
  const [total, items] = await Promise.all([
    db.call.count({ where }),
    db.call.findMany({ where, orderBy: { startedAt: "desc" }, skip: (page - 1) * perPage, take: perPage }),
  ]);
  res.json({ total, page, perPage, items });
});

const Emails = Paging.extend({
  sequence: z.string().max(300).optional(),
  stage: z.string().max(100).optional(),
  status: z.enum(["opened", "clicked", "replied", "bounced"]).optional(),
  q: z.string().max(100).optional(),
});

recordsRouter.get("/emails", requireUser, async (req, res) => {
  const p = Emails.safeParse(req.query);
  if (!p.success) return void res.status(400).json({ error: "Invalid query" });
  const { page, perPage, sequence, stage, status, q } = p.data;

  const where: Prisma.EmailWhereInput = {
    ...(sequence && { sequence }),
    ...(stage && { contactStage: stage }),
    ...(status === "opened" && { open: true }),
    ...(status === "clicked" && { click: true }),
    ...(status === "replied" && { replied: true }),
    ...(status === "bounced" && { bounce: true }),
    ...(q && {
      OR: [
        { subject: { contains: q, mode: "insensitive" } },
        { toEmail: { contains: q, mode: "insensitive" } },
        { toCompany: { contains: q, mode: "insensitive" } },
      ],
    }),
  };
  const [total, items] = await Promise.all([
    db.email.count({ where }),
    db.email.findMany({ where, orderBy: { sentAt: "desc" }, skip: (page - 1) * perPage, take: perPage }),
  ]);
  res.json({ total, page, perPage, items });
});
