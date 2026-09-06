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
