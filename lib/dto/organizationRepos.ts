// DTO types for the ORGANISATION's repository inventory (Story MOTIR-4669 ·
// MOTIR-4678) — the shape the `Add repository` picker's first segment binds to.
// No Prisma row leaks; every `Date` is an ISO string.

/** Wire form of the Prisma `GitProvider` enum, as the picker renders it. */
export type OrgRepoProviderDto = 'github' | 'gitlab';

/**
 * ONE ROW OF THE PICKER'S FIRST SEGMENT — a repository the organisation is
 * already connected to, offered for a project to pick.
 *
 * ⚠️ EVERY ROW OF THIS LIST IS FREE TO PICK, and that is the DTO's whole
 * contract rather than a property of one field. It carries no index state, no
 * cost hint and no "will this re-index?" flag, because the answer is always no —
 * the repository is connected, the graph exists, and linking it is one row.
 * Nothing here should grow a field that implies otherwise.
 */
export interface OrgRepoOptionDto {
  /** The internal `GithubRepo.id` — what a link write names. */
  id: string;
  owner: string;
  name: string;
  /** `owner/name`, precomputed so three consumers do not each join it. */
  fullName: string;
  defaultBranch: string;
  provider: OrgRepoProviderDto;
  archived: boolean;
  /**
   * The workspace the repository was connected FROM. Present because the
   * organisation spans workspaces and a person picking from a long list needs to
   * know where a name came from — NOT because it scopes anything. Tenancy is the
   * organisation; this is provenance.
   */
  connectedFromWorkspaceId: string | null;
}

/**
 * A project holding a repository, as the `Used by N projects` expansion names it.
 *
 * ⚠️ THE LIST IS ACCESS-FILTERED, AND THE COUNT IS ITS LENGTH — never a separate
 * number. An org member reads this inventory (the row gate is org membership, per
 * `organization-tier.md` §6), and the organisation contains projects they may not
 * browse. A count of 4 beside a list of 2 tells them a private project exists and
 * is exactly the leak the expansion was drawn to avoid.
 */
export interface UsingProjectDto {
  id: string;
  name: string;
  /** The project's key ("MOTIR"), so a consumer can link without a second read. */
  identifier: string;
  workspaceId: string;
}

/**
 * ONE REPOSITORY'S USAGE — the disclosure mechanism (`design/github` panel 6
 * draws it on the row AT REST) and the same data the org-level disconnect dialog
 * enumerates. ONE read, both consumers, so the count on the row and the names in
 * the dialog cannot disagree.
 */
export interface OrgRepoUsageDto {
  /** The internal `GithubRepo.id`. */
  githubRepoId: string;
  /** `owner/name` — what a dialog headline says. */
  repoRef: string;
  /** The projects the VIEWER may browse that hold this repository. */
  projects: UsingProjectDto[];
}

/**
 * WHAT MOTIR KNOWS ABOUT A REPOSITORY'S CODE INDEX — and it is deliberately two
 * values, not the four the design draws (Story MOTIR-4669 · MOTIR-4680).
 *
 * ⚠️ `stale` AND `indexing` ARE ABSENT BECAUSE THEY HAVE NO PRODUCER, not because
 * they were forgotten. Both were measured against `origin/main` and both are
 * blocked by properties the owning code documents about ITSELF:
 *
 *   - **stale** needs the indexed commit compared against the default-branch
 *     head. `prisma/schema.prisma` carries NEITHER column.
 *     `jobRunRepository.listSucceededCodeGraphIndexRepoRefs` says so in its own
 *     words: *"Staleness (graph commit vs the default-branch head) is
 *     MOTIR-1754/1766's axis and deliberately not read here."*
 *   - **indexing** is NOT ATTRIBUTABLE. `findRunningCodeGraphIndexForWorkspace`
 *     says it: *"a `running` row has no `output.repoRef` … so the ledger cannot
 *     say WHICH repo a running row belongs to — only that one is in flight."*
 *     `FleetInFlightSlot.ref` is the index-RUN id, not a repository.
 *
 * Rendering `Current` for a repository whose graph may be months behind would
 * tell a person their index matches their code at the exact moment they are
 * deciding whether to trust a plan built from it. That is not a missing feature;
 * it is a wrong answer. So this union says only what is known — `indexed` claims
 * an index HAPPENED, never that it is current — and the two missing arms arrive
 * with their substrate.
 */
export type OrgRepoIndexStateDto = 'indexed' | 'never';

/** One row of the organisation's repository inventory (MOTIR-4680). */
export interface OrgRepoInventoryRowDto {
  repo: OrgRepoOptionDto;
  /** The projects the VIEWER may browse that hold it — count IS the list length. */
  projects: UsingProjectDto[];
  indexState: OrgRepoIndexStateDto;
}
