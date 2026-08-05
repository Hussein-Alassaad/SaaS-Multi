import { create } from "zustand";

interface UiState {
  sidebarExpanded: boolean;
  setSidebarExpanded: (v: boolean) => void;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (v: boolean) => void;
  impersonation: { tenantId: string; tenantName: string } | null;
  startImpersonation: (tenantId: string, tenantName: string) => void;
  endImpersonation: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarExpanded: false,
  setSidebarExpanded: (v) => set({ sidebarExpanded: v }),
  mobileMenuOpen: false,
  setMobileMenuOpen: (v) => set({ mobileMenuOpen: v }),
  impersonation: null,
  startImpersonation: (tenantId, tenantName) => set({ impersonation: { tenantId, tenantName } }),
  endImpersonation: () => set({ impersonation: null }),
}));
