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
