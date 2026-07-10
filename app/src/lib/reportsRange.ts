export function rangeFromKey(key: string): {
  start: string;
  end: string;
  label: string;
} {
  const today = new Date();
  const end = iso(today);
  if (key === "week") {
    const start = new Date(today);
    const dow = start.getDay();
    start.setDate(start.getDate() - (dow === 0 ? 6 : dow - 1));
    return { start: iso(start), end, label: "This week" };
  }
  if (key === "lastMonth") {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const last = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: iso(start), end: iso(last), label: "Last month" };
  }
  if (key === "3months") {
    const start = new Date(today);
    start.setMonth(start.getMonth() - 3);
    return { start: iso(start), end, label: "Last 3 months" };
  }
  if (key === "year") {
    return {
      start: `${today.getFullYear()}-01-01`,
      end,
      label: "This year",
    };
  }
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  return { start: iso(start), end, label: "This month" };
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
