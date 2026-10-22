export type EmailRule = { kind: "mailbox" | "sequence" | "domain"; value: string; clientId: number };

export const senderDomain = (email: string | null | undefined) => {
  const at = (email ?? "").lastIndexOf("@");
  return at >= 0 ? email!.slice(at + 1).trim().toLowerCase() : null;
};

export const mailbox = (email: string | null | undefined) => (email ? email.trim().toLowerCase() : null);

/**
 * Which client an email belongs to. Each client sends from its own domain, so the sender's domain decides.
 * A specific mailbox or sequence rule, if one exists, wins over the domain. No rule means "not mapped yet" (null).
 */
export function resolveEmailClient(rules: EmailRule[], e: { from: string | null; sequence: string | null }): number | null {
  const box = mailbox(e.from);
  const seq = e.sequence ? e.sequence.trim().toLowerCase() : null;
  const dom = senderDomain(e.from);
  const find = (kind: EmailRule["kind"], value: string | null) => (value ? rules.find((r) => r.kind === kind && r.value === value) : undefined);
  return (find("mailbox", box) ?? find("sequence", seq) ?? find("domain", dom))?.clientId ?? null;
}
