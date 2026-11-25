"use client";

import { useEffect, useState } from "react";

import { voucherInfoFrom, type VoucherInfo, type VoucherLookupResponse } from "@/lib/booking/voucherModel";

/** Looks a typed voucher code up (250ms after typing stops) while paying by voucher. */
export function useVoucherLookup(code: string, enabled: boolean): VoucherInfo {
  const [info, setInfo] = useState<VoucherInfo>({ state: "idle" });

  useEffect(() => {
    if (!enabled || !code) {
      setInfo({ state: "idle" });
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      fetch(`/api/vouchers/${encodeURIComponent(code)}`)
        .then((r) => r.json())
        .then((d: VoucherLookupResponse) => {
          if (live) setInfo(voucherInfoFrom(d));
        })
        .catch(() => {
          if (live) setInfo({ state: "invalid" });
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [code, enabled]);

  return info;
}
