// The shapes the backend sends. Every number on screen is worked out on the server.

export type DispositionKey =
  | "mql" | "interested" | "callback" | "not_interested" | "wrong_number" | "mql_fu" | "dnc" | "no_answer" | "bad_number" | "voicemail" | "meeting";

export type Stats = {
  calls: number; connects: number; meaningful: number;
  mql: number; mqlOver90: number; mqlUnder90: number;
  answered: number; notAnswered: number;
  dispositions: Record<"mql" | "interested" | "callback" | "not_interested" | "wrong_number" | "mql_fu" | "dnc" | "no_answer" | "bad_number", number>;
};

export type Range = { from: string; to: string };
export type Schedule = { start: number; breakStart: number; breakEnd: number };

type ClockSchedule = { start: string; breakStart: string; breakEnd: string }; // "HH:MM", 24 hour
export type TimingSettings = {
  gapMinutes: number; breakMinMinutes: number; windowMinutes: number; graceMinutes: number; allowedBreakMinutes: number;
  default: ClockSchedule; clients: Record<string, ClockSchedule>;
};

export type Meta = {
  dateMin: string; dateMax: string; today: string; shiftZone: string; meaningfulSeconds: number;
  clients: { id: number; name: string; showPhone: boolean }[];
  representatives: { id: number; name: string }[];
  timing: TimingSettings;
};

export type Overview = {
  range: Range; weeksOfCalls: number;
  activeClients: { count: number; of: number };
  revenue: { total: number; orders: number; avgOrder: number | null; weeklyRunRate: number | null; weeks: number; lastUpload: string | null };
  calls: { dials: number; connects: number; meaningful: number; mql: number; mqlOver90: number; mqlUnder90: number; answered: number; notAnswered: number };
  emails: { sent: number; delivered: number; opened: number; clicked: number; replied: number; bounced: number; unsubscribed: number; clientsWithData: number };
  byClient: { clientId: number; name: string; dials: number; connects: number; meaningful: number; mqls: number; orders: number; revenue: number; emailsSent: number; opened: number; replied: number }[];
};

export type Node = { id: number; name: string; stats: Stats; children: { id: number; name: string; stats: Stats }[] };
export type RepTable = {
  range: Range; reps: Node[]; total: Stats; weeks: number;
  kpis: { current: { calls: number; connects: number; meaningful: number }; previous: { calls: number; connects: number; meaningful: number } | null; previousRange: Range | null };
};
export type ClientTable = { range: Range; clients: Node[]; total: Stats; weeks: number };

export type Profile = {
  kind: "rep" | "client"; id: number; name: string; range: Range;
  options: { id: number; name: string; calls: number }[]; selected: number[];
  stats: Stats; revenue: { total: number; orders: number } | null; recordings: number;
};

export type Prospect = { kind: "none" } | { kind: "one" | "multiple"; name: string | null; company: string | null; title: string | null; candidates: string | null };
export type Recording = {
  id: string; date: string; time: string; clientId: number; client: string; representativeId: number; representative: string;
  durationSec: number; disposition: DispositionKey | null; url: string; phone: string | null; prospect: Prospect;
};
export type Recordings = {
  total: number; hasMore: boolean; items: Recording[];
  counts: { all: number; answered: number; notAnswered: number; sub: Record<string, number> };
};

export type EmailRow = {
  id: string; subject: string | null; sentAt: string; toName: string | null; toEmail: string | null; toCompany: string | null;
  step: number | null; sequence: string | null; stage: string | null;
  opened: boolean; clicked: boolean; replied: boolean; bounced: boolean; unsubscribed: boolean;
};
export type Emails = {
  summary: { sent: number; opened: number; replied: number; bounced: number; unsubscribed: number };
  counts: { all: number; opened: number; replied: number; bounced: number };
  total: number; hasMore: boolean; items: EmailRow[];
};
export type EmailDetail = { id: string; fromEmail: string | null; toEmail: string | null; subject: string | null; sentAt: string | null; bodyHtml: string | null; replied: boolean; replyText: string | null };

type RevCell = { revenue: number; orders: number; by: { id: number; name: string; orders: number; revenue: number }[] };
export type Revenue = {
  by: "rep" | "client"; range: Range;
  weeks: { monday: string; isoWeek: number; to: string }[];
  rows: { id: number; name: string; total: number; cells: Record<string, RevCell> }[];
  totals: RevCell[];
  summary: { revenue: number; orders: number; avgOrder: number | null; runRate: number | null; groupsWithOrders: number };
};

export type RepDay = {
  representativeId: number; name: string; clients: { id: number; name: string }[];
  calls: number; first: number; last: number; schedule: Schedule;
  blocks: { s: number; e: number; clientId: number; n: number }[];
  main: { from: number; to: number; len: number; before: number; after: number } | null;
  other: { from: number; to: number; len: number }[];
  firstDelta: number; breakStartDelta: number | null; returnDelta: number | null; breakLenDelta: number | null;
  lateStart: boolean; lateReturn: boolean; breakOver: boolean;
};
export type TimingSummary = { dialing: number; breaks: number; avgBreak: number | null; breakOver: number; backLate: number; lateStart: number };
export type TimingDays = { days: string[]; weeks: { monday: string; representatives: { id: number; name: string; dials: number }[] }[] };
export type TimingDay = { date: string; reps: RepDay[]; summary: TimingSummary; settings: TimingSettings };
export type TimingWeek = {
  week: string; representative: { id: number; name: string };
  days: { date: string; day: RepDay | null }[];
  summary: TimingSummary & { dials: number; daysDialed: number }; settings: TimingSettings;
};
