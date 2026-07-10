import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth";
import { listStaff, payrollMetrics, performanceMetrics } from "@/lib/staff";
import { addDaysIso, todayIso } from "@/lib/timetable";
import { StaffView } from "@/components/staff/StaffView";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

interface Props {
  searchParams: { payFrom?: string; payTo?: string; perfFrom?: string; perfTo?: string };
}

export default async function StaffPage({ searchParams }: Props) {
  await requireUser();

  const today = todayIso();
  const monthStart = `${today.slice(0, 7)}-01`;
  const payFrom = ISO.test(searchParams.payFrom ?? "") ? searchParams.payFrom! : monthStart;
  const payTo = ISO.test(searchParams.payTo ?? "") ? searchParams.payTo! : today;
  const perfFrom = ISO.test(searchParams.perfFrom ?? "") ? searchParams.perfFrom! : addDaysIso(today, -29);
  const perfTo = ISO.test(searchParams.perfTo ?? "") ? searchParams.perfTo! : today;

  const roster = listStaff().map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    phone: s.phone,
    title: s.title,
    payType: s.payType,
    payRateCents: s.payRateCents,
    isApproved: s.isApproved,
    isActive: s.isActive,
    notes: s.notes,
  }));

  return (
    <div className="app-page">
      <PageHeader eyebrow="Team" title="Staff" subtitle="Your instructors — roster, payroll and performance." />
      <StaffView
        roster={roster}
        payroll={payrollMetrics(payFrom, payTo)}
        performance={performanceMetrics(perfFrom, perfTo)}
        payFrom={payFrom}
        payTo={payTo}
        perfFrom={perfFrom}
        perfTo={perfTo}
      />
    </div>
  );
}
