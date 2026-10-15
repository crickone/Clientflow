/**
 * What each DNS record a sending domain needs is for, in words an owner can
 * follow, and whether it's in place yet. Pure, so the card and its test share it.
 */

export type DnsRecord = { type: string; name: string; value: string; valid?: boolean };

export type RecordJob = {
  key: "spf" | "dkim" | "tracking" | "mx" | "other";
  title: string;
  what: string;
};

export function recordJob(r: DnsRecord): RecordJob {
  const type = r.type.toUpperCase();
  if (type === "TXT" && /^v=spf1/i.test(r.value.trim())) {
    return { key: "spf", title: "Sending permission", what: "Lets our email service send from this domain (SPF)." };
  }
  if (type === "TXT" && /_domainkey\./i.test(r.name)) {
    return { key: "dkim", title: "Email signature", what: "Signs each email so inboxes can tell it really came from you (DKIM)." };
  }
  if (type === "CNAME") {
    return { key: "tracking", title: "Open and click tracking", what: "Lets campaigns count opens and clicks." };
  }
  if (type === "MX") {
    return { key: "mx", title: "Bounce handling", what: "Receives bounce notices for this domain." };
  }
  return { key: "other", title: `${type} record`, what: "Asked for by our email service." };
}

/** Found in DNS: the provider's own word when it gave one, otherwise the domain's overall state. */
export function recordFound(r: DnsRecord, domainVerified: boolean): boolean {
  return r.valid ?? domainVerified;
}

/** The part of a host name to type at registrars that add the domain themselves. */
export function hostPart(name: string, rootDomain: string | null): string {
  if (!rootDomain) return name;
  const n = name.toLowerCase().replace(/\.$/, "");
  const root = rootDomain.toLowerCase();
  if (n === root) return "@";
  return n.endsWith(`.${root}`) ? n.slice(0, -(root.length + 1)) : name;
}

/** The registrable domain behind a sending subdomain: mg.example.ie -> example.ie, mg.example.co.uk -> example.co.uk. */
export function rootOf(domain: string): string {
  const parts = domain.toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const twoPart = /^(co|com|org|net|gov|ac|edu)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2;
  return parts.slice(twoPart ? -3 : -2).join(".");
}
