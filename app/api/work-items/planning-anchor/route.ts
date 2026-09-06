import { NextResponse } from 'next/server';
import { getActiveProject } from '@/lib/projects';
import { workItemsService } from '@/lib/services/workItemsService';
import { WorkItemNotFoundError } from '@/lib/workItems/errors';
import { ProjectAccessDeniedError, ProjectNotFoundError } from '@/lib/projects/errors';
import { refuseIfNonCompliant } from '@/lib/auth/requireCompliantSession';

// GET /api/work-items/planning-anchor?key=<identifier> (MOTIR-4727) — the ANCHOR
// half of a work-item launch of the planning workspace, fetched CLIENT-side.
//
// The workspace is moving from a route to an OVERLAY mounted in the authed shell
// (MOTIR-4725). `app/(planning)/planning/page.tsx` resolved this SERVER-side —
// one `getWorkItemWithAncestors` whose result seeded three things at once: the
// conversation's `anchorId` (MOTIR-909), the pre-filled `@`-mention target
// (MOTIR-1491), and the canvas's arrival trail (MOTIR-2070), so the canvas opens
// on the anchor's OWN level. An overlay is a client island and no client
// component may reach the service layer (CLAUDE.md's 4-layer rule), so the read
// needs an HTTP door.
//
// Built in the exact shape of `app/api/work-items/peek/route.ts` (bug 8.8.2) —
// the data half of the other URL-driven modal: resolve against the actor's
// ACTIVE project, the 2FA hold AFTER the no-project arm, a thin call into the
// service, and the no-existence-leak 404.
//
// Thin HTTP over `workItemsService.getWorkItemWithAncestors` — the SAME
// view-gated lineage read the retiring page and `/roadmap?item=` already make.
// No `db` / no `$transaction` here, and no new service method.
//
// A stale / deleted / cross-workspace / forbidden key is the same 404 (never a
// 403, which would leak "it exists but you can't see it"). The overlay renders
// that as the project conversation at the root — the page's own silent-catch
// semantics, one hop over the wire.
export async function GET(req: Request): Promise<Response> {
  const ctx = await getActiveProject();
  if (!ctx) {
    return NextResponse.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  // The 2FA hold (MOTIR-3653) — placed AFTER the no-project arm, exactly where
  // the peek places it: the no-project answer is its own and must not be
  // reported as a compliance refusal. `ctx.userId` is the session user
  // `getWorkspaceContext` already resolved, so this costs one policy query.
  const hold = await refuseIfNonCompliant(ctx.userId);
  if (hold) return hold;

  const key = new URL(req.url).searchParams.get('key')?.trim();
  if (!key) {
    return NextResponse.json({ code: 'BAD_REQUEST', error: '`key` is required.' }, { status: 400 });
  }

  try {
    const { item, ancestors } = await workItemsService.getWorkItemWithAncestors(
      ctx.projectId,
      key,
      { userId: ctx.userId, workspaceId: ctx.workspaceId },
    );
    // BOTH halves the page composed, raw — the CONSUMER decides the trail. The
    // workspace opens on the anchor's OWN level (ancestors only); the roadmap
    // opens INSIDE the item (ancestors plus the item). One body serves both, and
    // neither is baked in here.
    return NextResponse.json(
      {
        anchor: {
          id: item.id,
          identifier: item.identifier,
          title: item.title,
          kind: item.kind,
        },
        ancestors: ancestors.map((a) => ({
          id: a.id,
          identifier: a.identifier,
          title: a.title,
        })),
      },
      {
        // The anchor's title and its ancestors' titles are live item state;
        // never serve a stale chip or a stale breadcrumb.
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  } catch (err) {
    if (
      err instanceof WorkItemNotFoundError ||
      err instanceof ProjectAccessDeniedError ||
      err instanceof ProjectNotFoundError
    ) {
      return NextResponse.json(
        { code: 'NOT_FOUND', error: 'Work item not available.' },
        { status: 404 },
      );
    }
    throw err;
  }
}
