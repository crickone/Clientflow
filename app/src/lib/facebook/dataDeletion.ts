import "server-only";

import { deleteGrant, tenantsConnectedBy } from "./grants";
import { disconnectFacebookPage, listFacebookPages } from "./pages";

/**
 * Carry out a Meta data deletion request (the person removed the Adonis Agent
 * app from their Facebook account). Everything AdonisAgent holds BECAUSE of
 * that person's Facebook connection goes: the grant token, every Page they
 * connected (unsubscribed and its token wiped) and the ad accounts the grant
 * listed. The business's own records (its leads, clients and conversations)
 * belong to the business, not to the person who connected Facebook, and stay.
 *
 * Returns the tenants affected; an empty list means nothing was held for that
 * user (or the connection predates recording the Facebook user id).
 */
export async function deleteMetaDataForUser(fbUserId: string): Promise<number[]> {
  const tenants = tenantsConnectedBy(fbUserId);
  for (const tenantId of tenants) {
    for (const page of listFacebookPages(tenantId)) {
      await disconnectFacebookPage(tenantId, page.pageId).catch((err) => {
        console.error(`[meta] data deletion: could not disconnect Page for tenant ${tenantId}:`, err);
      });
    }
    deleteGrant(tenantId);
  }
  return tenants;
}
