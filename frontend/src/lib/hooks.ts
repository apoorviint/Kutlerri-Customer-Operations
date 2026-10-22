"use client";

import { useEffect, useState } from "react";
import { api, type Me } from "./api";

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api<Me>("/auth/me").then(setMe).catch(() => {});
  }, []);
  return me;
}

/** Fetches `path` whenever it changes. Stale responses from an earlier path are ignored. */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null, error: null, loading: path !== null,
  });
  useEffect(() => {
    if (path === null) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api<T>(path)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((e: Error) => live && setState((s) => ({ ...s, error: e.message, loading: false })));
    return () => {
      live = false;
    };
  }, [path]);
  return state;
}
