// The daily automation scheduler is started via a side-effect import in the root
// layout (see src/app/layout.tsx → "@/lib/automations/scheduler"), which keeps
// better-sqlite3 out of the edge/instrumentation bundle. This file is a no-op.
export function register() {}
