import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import type { PlatformPrincipal } from '@/lib/platform/auth';
import {
  MissingAuditReasonError,
  PlatformClassificationStateError,
  PlatformOrganizationNotFoundError,
} from '@/lib/platform/errors';
import {
  PLATFORM_ORG_SEARCH_MIN_LENGTH,
  platformBillingClassificationService,
} from '@/lib/services/platformBillingClassificationService';
import { createTestUser } from '../fixtures/userFixtures';
import { adminDb } from '../helpers/adminDb';
import { truncateAuthTables } from '../helpers/db';

/**
 * The INTERNAL-BILLING classification (Story MOTIR-4337 · MOTIR-4565).
 *
 * Four properties carry the weight, and each is tested from the side that can
 * actually fail:
 *
 * 1. **The `organization` platform-staff ARMS exist and are what make the reads
 *    answer.** This is the one property that would fail SILENTLY without a test:
 *    an unarmed read returns zero rows and raises nothing, so the service would
 *    report "no such organization" for an org that plainly exists. The arms are
 *    asserted from the catalog AND exercised through the non-bypass role.
 * 2. **A reason is REQUIRED for every write**, enforced in the transaction
 *    rather than in the dialog — asserted by calling the service directly with a
 *    blank one, which is what a Server Action invoked without the dialog does.
 * 3. **A refused write leaves NO audit row.** ADR §3a's property, and the way to
 *    break it is to return a sentinel and throw outside the transaction. Every
 *    refusal below is checked against the row count, not just the thrown type.
 * 4. **Two concurrent writes produce ONE change and ONE row.** The `FOR UPDATE`
 *    re-read is exercised rather than merely present — a check-then-write with
 *    no lock passes every single-threaded test in this file.
 */

vi.mock('@/lib/platform/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/platform/auth')>('@/lib/platform/auth');
  return {
    ...actual,
    // The one `vi.mock` `CLAUDE.md` allows, at the platform tier's equivalent of
    // `getSession` — the test environment has no cookies. Everything under it is
    // the real path against real Postgres, and the DEGREE is honoured rather than
    // waved through: the stub re-runs the ladder comparison the real gate makes,
    // so criterion 8's `support`-cannot-write assertion tests the service's own
    // `requirePlatformStaff('superadmin')` call and not the mock.
    requirePlatformStaff: vi.fn(
      async (minimum: 'support' | 'operator' | 'superadmin' = 'support') => {
        if (!currentPrincipal) throw new actual.NotPlatformStaffError();
        if (!actual.platformRoleAtLeast(currentPrincipal.role, minimum)) {
          throw new actual.NotPlatformStaffError();
        }
        return currentPrincipal;
      },
    ),
  };
});

let currentPrincipal: PlatformPrincipal | null = null;

async function seedOperator(role: 'support' | 'operator' | 'superadmin' = 'superadmin') {
  const user = await createTestUser({ email: `ops+org-${role}@moooon.net` });
  await adminDb.user.update({ where: { id: user.id }, data: { platformRole: role } });
  return { userId: user.id, email: user.email, role } satisfies PlatformPrincipal;
}

async function seedOrg(overrides: { name?: string; slug?: string; isMeta?: boolean } = {}) {
  return adminDb.organization.create({
    data: {
      name: overrides.name ?? 'Northwind Labs',
      slug: overrides.slug ?? `northwind-${Math.random().toString(36).slice(2, 8)}`,
      isMeta: overrides.isMeta ?? false,
    },
  });
}

async function auditRows() {
  return adminDb.platformAuditLog.findMany({ orderBy: { createdAt: 'asc' } });
}

beforeEach(async () => {
  await adminDb.$executeRawUnsafe('TRUNCATE TABLE "platform_audit_log" RESTART IDENTITY CASCADE');
  await truncateAuthTables();
  currentPrincipal = await seedOperator();
});

afterAll(async () => {
  await db.$disconnect();
  await adminDb.$disconnect();
});

describe('the `organization` platform-staff policy arms (MOTIR-4565)', () => {
  it('ships a SELECT arm and an UPDATE arm bound to `app.platform_staff`, and only those', async () => {
    const rows = await adminDb.$queryRaw<
      { policyname: string; cmd: string; qual: string | null; with_check: string | null }[]
    >`
      SELECT "policyname", "cmd", "qual", "with_check"
      FROM pg_policies
      WHERE "tablename" = 'organization' AND "qual" LIKE '%app.platform_staff%'
      ORDER BY "policyname"
    `;

    expect(rows.map((r) => r.policyname)).toEqual([
      'organization_platform_staff_read',
      'organization_platform_staff_update',
    ]);
    expect(rows.map((r) => r.cmd)).toEqual(['SELECT', 'UPDATE']);
    // The UPDATE arm must carry BOTH halves: `USING` decides which rows the
    // statement may see, `WITH CHECK` what the updated row may look like. An
    // UPDATE policy with only `USING` lets a platform write produce a row the
    // policy would not have admitted.
    expect(rows[1]?.with_check).toContain('app.platform_staff');
  });

  it('arms NO other table — this card takes `organization` and only `organization` (MOTIR-730 keeps the rest)', async () => {
    const rows = await adminDb.$queryRaw<{ tablename: string }[]>`
      SELECT DISTINCT "tablename"
      FROM pg_policies
      WHERE "qual" LIKE '%app.platform_staff%' OR "with_check" LIKE '%app.platform_staff%'
      ORDER BY "tablename"
    `;
    // `platform_audit_log` is MOTIR-2896's own table — the gate's, not a tenant
    // table — and is the only other member.
    expect(rows.map((r) => r.tablename)).toEqual(['organization', 'platform_audit_log']);
  });

  it('does NOT widen a TENANT context: a workspace-scoped read still sees no other org', async () => {
    const mine = await seedOrg({ name: 'Mine', slug: 'mine-org' });
    const stranger = await seedOrg({ name: 'Stranger', slug: 'stranger-org' });

    // The non-bypass role, with the tenant GUCs bound and NO platform flag —
    // exactly what `withWorkspaceContext` produces for an ordinary request.
    const rows = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${currentPrincipal!.userId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${mine.id}, true)`;
      await tx.$executeRawUnsafe('SET LOCAL ROLE motir_app');
      return tx.organization.findMany({ where: { id: stranger.id } });
    });

    expect(rows).toEqual([]);
  });

  it('the arm is what makes the read answer: the same query under the non-bypass role sees rows ONLY with the platform GUC set', async () => {
    const org = await seedOrg({ name: 'Acme Corp', slug: 'acme-armed' });

    const withoutFlag = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE motir_app');
      return tx.organization.findMany({ where: { id: org.id } });
    });
    const withFlag = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.platform_staff', 'true', true)`;
      await tx.$executeRawUnsafe('SET LOCAL ROLE motir_app');
      return tx.organization.findMany({ where: { id: org.id } });
    });

    expect(withoutFlag).toEqual([]);
    expect(withFlag.map((r) => r.id)).toEqual([org.id]);
  });
});

describe('platformBillingClassificationService — reads', () => {
  it('finds organizations by name and by slug, and returns both classification flags separately', async () => {
    const meta = await seedOrg({ name: 'moooon B.V.', slug: 'moooon-test', isMeta: true });
    await seedOrg({ name: 'Northwind Labs', slug: 'northwind-a' });

    const byName = await platformBillingClassificationService.searchOrganizations(
      currentPrincipal!,
      'moooon',
    );
    const bySlug = await platformBillingClassificationService.searchOrganizations(
      currentPrincipal!,
      'northwind-a',
    );

    expect(byName.map((o) => o.id)).toEqual([meta.id]);
    // Two flags, two fields — never one collapsed `internal` boolean.
    expect(byName[0]).toMatchObject({ isMeta: true, internalBilling: false });
    expect(bySlug).toHaveLength(1);
  });

  it('returns [] under the query floor rather than throwing', async () => {
    await seedOrg({ name: 'Acme', slug: 'acme-floor' });
    const short = 'a'.repeat(PLATFORM_ORG_SEARCH_MIN_LENGTH - 1);
    expect(
      await platformBillingClassificationService.searchOrganizations(currentPrincipal!, short),
    ).toEqual([]);
    // …and it costs no audit row: nothing was read.
    expect(await auditRows()).toHaveLength(0);
  });

  it('reads one organization and writes exactly one `estate.read` row with no reason', async () => {
    const org = await seedOrg({ name: 'Acme Corp', slug: 'acme-read' });

    const dto = await platformBillingClassificationService.getOrganization(
      currentPrincipal!,
      org.id,
    );

    expect(dto).toMatchObject({ id: org.id, slug: 'acme-read', internalBilling: false });
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'estate.read',
      targetKind: 'organization',
      targetId: org.id,
      reason: null,
    });
  });

  it('a missing organization throws INSIDE the transaction, so the read leaves no audit row', async () => {
    await expect(
      platformBillingClassificationService.getOrganization(currentPrincipal!, 'cmnot-a-real-id'),
    ).rejects.toBeInstanceOf(PlatformOrganizationNotFoundError);
    expect(await auditRows()).toHaveLength(0);
  });
});

describe('platformBillingClassificationService — the classification write', () => {
  it('classifies an org and writes exactly ONE audit row carrying the actor, the target and the reason', async () => {
    const org = await seedOrg({ name: 'moooon B.V.', slug: 'moooon-set' });

    const dto = await platformBillingClassificationService.setInternalBilling(
      currentPrincipal!,
      org.id,
      true,
      'Dogfood org — bills like a customer so we can see the paid screens (MOTIR-4337)',
    );

    expect(dto.internalBilling).toBe(true);
    expect(
      (await adminDb.organization.findUnique({ where: { id: org.id } }))?.internalBilling,
    ).toBe(true);

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'org.internal_billing_set',
      actorUserId: currentPrincipal!.userId,
      actorRole: 'superadmin',
      targetKind: 'organization',
      targetId: org.id,
      organizationId: org.id,
      reason: 'Dogfood org — bills like a customer so we can see the paid screens (MOTIR-4337)',
    });
  });

  it('unsets the classification and records the unset action, leaving the org otherwise untouched', async () => {
    const org = await seedOrg({ name: 'moooon B.V.', slug: 'moooon-unset', isMeta: true });
    await adminDb.organization.update({
      where: { id: org.id },
      data: { internalBilling: true },
    });

    const dto = await platformBillingClassificationService.setInternalBilling(
      currentPrincipal!,
      org.id,
      false,
      'Moved to a real paying plan',
    );

    expect(dto.internalBilling).toBe(false);
    // `isMeta` is a DIFFERENT flag and this write does not read or move it.
    expect(dto.isMeta).toBe(true);
    expect((await auditRows()).map((r) => r.action)).toEqual(['org.internal_billing_unset']);
  });

  it('refuses a blank or whitespace-only reason BEFORE any write, and leaves no audit row', async () => {
    const org = await seedOrg({ slug: 'acme-blank' });

    for (const reason of ['', '   ', '\n\t']) {
      await expect(
        platformBillingClassificationService.setInternalBilling(
          currentPrincipal!,
          org.id,
          true,
          reason,
        ),
      ).rejects.toBeInstanceOf(MissingAuditReasonError);
    }

    expect(await auditRows()).toHaveLength(0);
    expect(
      (await adminDb.organization.findUnique({ where: { id: org.id } }))?.internalBilling,
    ).toBe(false);
  });

  it('refuses setting the value it already has, and writes nothing', async () => {
    const org = await seedOrg({ slug: 'acme-already' });
    await adminDb.organization.update({ where: { id: org.id }, data: { internalBilling: true } });

    await expect(
      platformBillingClassificationService.setInternalBilling(
        currentPrincipal!,
        org.id,
        true,
        'A second operator, a minute later',
      ),
    ).rejects.toBeInstanceOf(PlatformClassificationStateError);

    expect(await auditRows()).toHaveLength(0);
  });

  it('refuses a missing organization, and writes nothing', async () => {
    await expect(
      platformBillingClassificationService.setInternalBilling(
        currentPrincipal!,
        'cmnot-a-real-id',
        true,
        'A stale link',
      ),
    ).rejects.toBeInstanceOf(PlatformOrganizationNotFoundError);
    expect(await auditRows()).toHaveLength(0);
  });

  it('two SIMULTANEOUS classifications produce exactly one change and exactly one audit row', async () => {
    const org = await seedOrg({ slug: 'acme-race' });

    // REAL concurrency, not two sequential calls: both transactions open before
    // either commits, so a check-then-write with no `FOR UPDATE` lets both read
    // "not classified" and both write. The lock is what makes the second one
    // re-read the committed value and refuse.
    const results = await Promise.allSettled([
      platformBillingClassificationService.setInternalBilling(
        currentPrincipal!,
        org.id,
        true,
        'Operator A, during the handover call',
      ),
      platformBillingClassificationService.setInternalBilling(
        currentPrincipal!,
        org.id,
        true,
        'Operator B, in the same minute',
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      PlatformClassificationStateError,
    );

    // ONE row, not two — the trail matches the org rather than out-counting it.
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('org.internal_billing_set');
    expect(
      (await adminDb.organization.findUnique({ where: { id: org.id } }))?.internalBilling,
    ).toBe(true);
  });
});

describe('platformBillingClassificationService — the degree ladder', () => {
  it('a `support` principal may READ an org and may NOT classify it', async () => {
    const org = await seedOrg({ slug: 'acme-degree' });
    currentPrincipal = await seedOperator('support');

    await expect(
      platformBillingClassificationService.getOrganization(currentPrincipal, org.id),
    ).resolves.toMatchObject({ id: org.id });

    await expect(
      platformBillingClassificationService.setInternalBilling(
        currentPrincipal,
        org.id,
        true,
        'A support operator reaching past their degree',
      ),
    ).rejects.toThrow();

    // The refused write left no row; the read above left exactly its own.
    expect((await auditRows()).map((r) => r.action)).toEqual(['estate.read']);
  });

  it('an `operator` principal may not classify either — this write is `superadmin` (ADR §7)', async () => {
    const org = await seedOrg({ slug: 'acme-operator' });
    currentPrincipal = await seedOperator('operator');

    await expect(
      platformBillingClassificationService.setInternalBilling(
        currentPrincipal,
        org.id,
        true,
        'An operator reaching past their degree',
      ),
    ).rejects.toThrow();
    expect(await auditRows()).toHaveLength(0);
  });

  it('a principal with no platform standing can do neither', async () => {
    const org = await seedOrg({ slug: 'acme-nobody' });
    currentPrincipal = null;

    await expect(
      platformBillingClassificationService.searchOrganizations(
        { userId: 'x', email: 'x@example.com', role: 'support' } as PlatformPrincipal,
        'acme',
      ),
    ).rejects.toThrow();
    await expect(
      platformBillingClassificationService.setInternalBilling(
        { userId: 'x', email: 'x@example.com', role: 'superadmin' } as PlatformPrincipal,
        org.id,
        true,
        'Nobody at all',
      ),
    ).rejects.toThrow();
    expect(await auditRows()).toHaveLength(0);
  });
});

describe('the audit vocabulary', () => {
  it('carries both new members at `reason: "required"`', async () => {
    const { PLATFORM_AUDIT_ACTIONS, reasonPolicyFor } = await import('@/lib/platform/auditActions');
    expect(PLATFORM_AUDIT_ACTIONS).toHaveProperty('org.internal_billing_set');
    expect(PLATFORM_AUDIT_ACTIONS).toHaveProperty('org.internal_billing_unset');
    expect(reasonPolicyFor('org.internal_billing_set')).toBe('required');
    expect(reasonPolicyFor('org.internal_billing_unset')).toBe('required');
  });
});
