import { redirect } from "next/navigation";

import { getCurrentClient } from "@/lib/clientAuth";
import { businessContact, onboardingFor } from "@/lib/agreements";
import { AgreeStep, WelcomeStep } from "@/components/clientapp/WelcomeSteps";
import { LogoutButton } from "@/components/clientapp/LogoutButton";

export const dynamic = "force-dynamic";

/**
 * Before the app opens: the documents to agree to, then the Welcome Q&A.
 * Every other /app page sends the member here until both are done
 * (requireClientPage); once they are, this sends them home.
 */
export default async function WelcomePage() {
  const c = getCurrentClient();
  if (!c) redirect("/app/login");
  const todo = onboardingFor(c.clientId);
  if (!todo) redirect("/app");
  const name = businessContact().name;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {todo.docs.length > 0 ? (
        <AgreeStep docs={todo.docs} businessName={name} step={todo.welcome ? "Step 1 of 2" : null} />
      ) : (
        <WelcomeStep title={todo.welcome!.title} questions={todo.welcome!.questions} businessName={name} step="Step 2 of 2" />
      )}
      <div style={{ marginTop: 8 }}>
        <LogoutButton />
      </div>
    </div>
  );
}
