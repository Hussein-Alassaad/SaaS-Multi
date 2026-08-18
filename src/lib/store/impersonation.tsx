"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface ImpersonationState {
  tenantId: string;
  tenantName: string;
  sessionId: string | null;
}

interface ImpersonationContextValue {
  impersonation: ImpersonationState | null;
  startImpersonation: (tenantId: string, tenantName: string, sessionId?: string | null) => void;
  endImpersonation: () => void;
}

const ImpersonationContext = createContext<ImpersonationContextValue | null>(null);

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const [impersonation, setImpersonation] = useState<ImpersonationState | null>(null);

  const startImpersonation = (tenantId: string, tenantName: string, sessionId: string | null = null) =>
    setImpersonation({ tenantId, tenantName, sessionId });
  const endImpersonation = () => setImpersonation(null);

  return (
    <ImpersonationContext.Provider value={{ impersonation, startImpersonation, endImpersonation }}>
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  const ctx = useContext(ImpersonationContext);
  if (!ctx) throw new Error("useImpersonation must be used within ImpersonationProvider");
  return ctx;
}
