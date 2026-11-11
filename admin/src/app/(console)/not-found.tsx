import Link from "next/link";

export default function ConsoleNotFound() {
  return (
    <div className="fault">
      <h1>No such page</h1>
      <p>The business or page you followed a link to is not here. It may have been purged, or the link is old.</p>
      <div className="fault-actions">
        <Link href="/gyms" className="btn btn--primary btn--md">
          All businesses
        </Link>
      </div>
    </div>
  );
}
