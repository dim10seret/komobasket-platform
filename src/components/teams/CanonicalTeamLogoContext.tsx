"use client";

import { createContext, useContext, type ReactNode } from "react";

const CanonicalTeamLogoContext = createContext<Record<string, string | null>>({});

export function CanonicalTeamLogoProvider({ logos, children }: {
  logos: Record<string, string | null>;
  children: ReactNode;
}) {
  return <CanonicalTeamLogoContext.Provider value={logos}>{children}</CanonicalTeamLogoContext.Provider>;
}

export function useCanonicalTeamLogos() {
  return useContext(CanonicalTeamLogoContext);
}
