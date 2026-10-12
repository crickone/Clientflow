import { Compass } from "lucide-react";

import { ProblemScreen } from "@/components/system/ProblemScreen";

export default function NotFound() {
  return (
    <ProblemScreen
      code="404"
      title="This page isn't here"
      body="The link may be old, or the page may have moved. Everything else is where you left it."
      icon={<Compass size={22} />}
    />
  );
}
