import { SettingsClient } from "./SettingsClient";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Settings</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          Global platform configuration: company info, brand, SMTP, and localization.
        </p>
      </div>

      <SettingsClient />
    </div>
  );
}
