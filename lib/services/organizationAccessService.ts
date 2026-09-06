import type { OrganizationRole, Prisma } from '@/generated/prisma/client';
import { organizationMembershipRepository } from '@/lib/repositories/organizationMembershipRepository';
import { isOrgAdminRole } from '@/lib/organizations/roles';
import { OrganizationNotFoundError, OrgForbiddenError } from '@/lib/organizations/errors';

/**
 * WHO MAY ADMINISTER AN ORGANISATION — asked in more than one service, so it is
 * declared once (Story MOTIR-4669 · MOTIR-4678).
 *
 * These two guards lived as private functions inside `organizationsService`.
 * MOTIR-4678 needs the same question answered from `organizationRepoService`,
 * and `lib/organizations/roles.ts` already says what happens when it is answered
 * twice: *"Two copies of 'who may administer an organization' is exactly the
 * shape that drifts when a fourth role is added."* Copying them would have made
 * that comment describe the tree. So they moved here and
 * `organizationsService` imports them — one definition, two callers.
 *
 * ⚠️ THE TWO GUARDS RAISE DIFFERENT ERRORS ON PURPOSE, and the difference is the
 * cross-tenant posture rather than a convenience:
 *
 *   - a NON-MEMBER gets `OrganizationNotFoundError` (→ 404). An org the actor is
 *     not in must be indistinguishable from an org that does not exist; a 403
 *     would confirm the id names something real.
 *   - a plain MEMBER of the org gets `OrgForbiddenError` (→ 403). They can
 *     already see the organisation, so there is nothing left to hide, and a 404
 *     here would tell them their own org had vanished.
 *
 * Both take the CALLER's `tx`: the membership read must run inside the same
 * transaction as the write it gates, or a concurrent role change could land
 * between the check and the effect.
 */
export async function assertOrgMember(
  userId: string,
  organizationId: string,
  tx: Prisma.TransactionClient,
): Promise<OrganizationRole> {
  const membership = await organizationMembershipRepository.findByOrgAndUserInTx(
    organizationId,
    userId,
    tx,
  );
  if (!membership) throw new OrganizationNotFoundError(organizationId);
  return membership.role;
}

/** {@link assertOrgMember}, then require the owner/admin tier. */
export async function assertOrgAdmin(
  userId: string,
  organizationId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const role = await assertOrgMember(userId, organizationId, tx);
  if (!isOrgAdminRole(role)) throw new OrgForbiddenError(userId, organizationId);
}
