import type { GithubRepo } from '@/generated/prisma/client';
import type { OrgRepoOptionDto, OrgRepoProviderDto } from '@/lib/dto/organizationRepos';

/** One `github_repo` row as the picker's first segment renders it (MOTIR-4678). */
export function toOrgRepoOptionDto(row: GithubRepo): OrgRepoOptionDto {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    fullName: `${row.owner}/${row.name}`,
    defaultBranch: row.defaultBranch,
    provider: row.provider as OrgRepoProviderDto,
    archived: row.archived,
    connectedFromWorkspaceId: row.workspaceId,
  };
}
