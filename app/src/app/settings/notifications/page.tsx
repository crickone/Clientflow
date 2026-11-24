import { PageHeader } from "@/components/layout/PageHeader";
import { NotificationSettings } from "@/components/notifications/NotificationSettings";
import { getCurrentMembership, requireUserPage } from "@/lib/auth";
import { kindsForRole } from "@/lib/notifications/model";
import { getPrefs, pushDeviceCount } from "@/lib/notifications/store";
import { vapidPublicKey } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Every staff member's own alerts: which kinds, in the app and on their devices. */
export default async function NotificationSettingsPage() {
  await requireUserPage();
  const m = getCurrentMembership()!;
  return (
    <div className="app-page" style={{ maxWidth: 760 }}>
      <PageHeader eyebrow="Settings" title="Notifications" subtitle="Choose what you hear about, in the app and on your phone or computer. These settings are yours alone." />
      <NotificationSettings
        kinds={kindsForRole(m.role)}
        prefs={getPrefs(m.user.id)}
        vapidKey={vapidPublicKey()}
        devices={pushDeviceCount(m.user.id)}
      />
    </div>
  );
}
