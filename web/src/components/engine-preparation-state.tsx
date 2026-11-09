import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { PreparationEngine } from '../engine/preparation';

export interface PreparationTicket {
  scope: string;
  engine: PreparationEngine;
  token: symbol;
}
interface Admission {
  scope: string;
  readyEngine: PreparationEngine | null;
  begin(ticket: PreparationTicket): void;
  ready(ticket: PreparationTicket): void;
  end(ticket: PreparationTicket): void;
}
const Context = createContext<Admission | null>(null);

/** Transient route admission only; no engine work or learning records live here. */
export function PreparationAdmissionProvider({
  scope,
  children,
}: {
  scope: string;
  children: ReactNode;
}) {
  const [current, setCurrent] = useState<(PreparationTicket & { ready: boolean }) | null>(null);
  const begin = useCallback((ticket: PreparationTicket) => {
    setCurrent({ ...ticket, ready: false });
  }, []);
  const ready = useCallback((ticket: PreparationTicket) => {
    setCurrent((value) =>
      value?.token === ticket.token && value.scope === ticket.scope
        ? { ...value, ready: true }
        : value,
    );
  }, []);
  const end = useCallback((ticket: PreparationTicket) => {
    setCurrent((value) => (value?.token === ticket.token ? null : value));
  }, []);
  const value = useMemo(
    () => ({
      scope,
      readyEngine: current?.scope === scope && current.ready ? current.engine : null,
      begin,
      ready,
      end,
    }),
    [scope, current, begin, ready, end],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePreparationAdmission() {
  return useContext(Context);
}
