// Token footer appended to tool replies. A tool may make several paid calls (list + summary), so the
// footer sums their net cost and reports the lowest balance seen, which does not depend on finish order.
import type { CreditInfo } from "./api-client.js";
import { freeToolNames } from "./free-tools.js";

// Low-balance threshold: the cost of a parcel report.
const PARCEL_REPORT_COST = 45;

// Null entries (no credit headers) are skipped; all null means no footer.
export function formatCreditFooter(...infos: (CreditInfo | null)[]): string {
  const seen = infos.filter((info): info is CreditInfo => Boolean(info));
  if (seen.length === 0) return "";

  let cost = 0;
  let refunded = 0;
  let balance = Infinity;
  for (const info of seen) {
    const net = Math.max(0, info.cost - (info.refunded ?? 0));
    cost += net;
    refunded += info.cost - net;
    balance = Math.min(balance, info.balance);
  }

  const refundNote = refunded > 0 ? `, ${refunded} refunded` : "";
  let footer = `\n---\nAPI tokens: ${balance} remaining as of this call (query cost: ${cost}${refundNote})`;
  if (balance < PARCEL_REPORT_COST) {
    footer += `\nLow balance: ${balance} ${balance === 1 ? "token" : "tokens"} left - a parcel report costs ${PARCEL_REPORT_COST}; free tools: ${freeToolNames().join(", ")}`;
  }
  return footer;
}
