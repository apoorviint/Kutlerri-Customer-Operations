export type Stats = {
  range: { days: number; since: string };
  calls: {
    total: number;
    connected: number;
    avgDurationSec: number | null;
    totalSeconds: number;
    byDay: { day: string; count: number }[];
    byAgent: { agent: string; count: number; connected: number; avg: number | null }[];
  };
  emails: {
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
    bounced: number;
    unsubscribed: number;
    byDay: { day: string; count: number }[];
    bySequence: { sequence: string; sent: number; opened: number; replied: number; bounced: number }[];
    byStage: { stage: string; count: number }[];
  };
  sync: {
    running: boolean;
    last: { ok: boolean; startedAt: string; finishedAt: string | null; error: string | null; calls: number; emails: number } | null;
  };
};

export type Filters = { agents: string[]; sequences: string[]; stages: string[] };

export type Paged<T> = { total: number; page: number; perPage: number; items: T[] };

export type CallItem = {
  id: string; contactNo: string | null; justcallNoName: string | null; agentName: string | null;
  recordingUrl: string | null; duration: number; startedAt: string; disposition: string | null;
};

export type EmailItem = {
  id: string; sequence: string | null; step: number | null; subject: string | null; toEmail: string | null;
  toName: string | null; toCompany: string | null; sentAt: string | null; open: boolean; click: boolean;
  replied: boolean; bounce: boolean; unsubscribe: boolean; contactStage: string | null;
};

export type Workbook = {
  file: string;
  error?: string;
  sheets: { name: string; header: string[]; rows: string[][]; totalRows: number }[];
};
