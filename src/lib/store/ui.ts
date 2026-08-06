import { create } from "zustand";

interface UiState {
  sidebarExpanded: boolean;
  setSidebarExpanded: (v: boolean) => void;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (v: boolean) => void;
  impersonation: { tenantId: string; tenantName: string; sessionId: string | null } | null;
  startImpersonation: (tenantId: string, tenantName: string, sessionId?: string | null) => void;
  endImpersonation: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarExpanded: false,
  setSidebarExpanded: (v) => set({ sidebarExpanded: v }),
  mobileMenuOpen: false,
  setMobileMenuOpen: (v) => set({ mobileMenuOpen: v }),
  impersonation: null,
  startImpersonation: (tenantId, tenantName, sessionId = null) =>
    set({ impersonation: { tenantId, tenantName, sessionId } }),
  endImpersonation: () => set({ impersonation: null }),
}));
