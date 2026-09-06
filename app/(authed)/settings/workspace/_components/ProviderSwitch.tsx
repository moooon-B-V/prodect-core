'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Segmented } from '@/components/ui/Segmented';
import { GithubMark } from '@/components/icons/GithubMark';
import { GitlabMark } from '@/components/icons/GitlabMark';

// The provider picker for the shared "Git" settings surface (Story 7.23 ·
// MOTIR-1478, design/gitlab Panel 1 + 6). The two providers — GitHub (7.10) and
// GitLab (7.23) — render through ONE shared shell; this Segmented [GitHub | GitLab]
// is the in-page door that swaps which provider's connect panel shows. Selecting a
// provider navigates to that provider's thin route (`/settings/workspace/github`
// | `/settings/workspace/gitlab`), both of which render the same shell with the
// other segment pressed — so the chrome is provably shared and only the connect
// content varies (the card's "provider is a variant, not a separate look").
//
// The shipped `Segmented` primitive: an accessible `role="group"` of real
// `<button aria-pressed>`s, coloured/shaped through `--el-*` + element-semantic
// tokens. The provider marks are the monochrome `currentColor` GithubMark /
// GitlabMark (no invented brand hue).

type Provider = 'github' | 'gitlab';

/**
 * ⚠️ THE DESTINATION IS A PROP NOW (MOTIR-4669 · MOTIR-4680), defaulting to the
 * shipped workspace routes so this file's original two callers are unchanged.
 *
 * The organisation's Git page is ONE route with the provider as a search param,
 * not two sibling routes: the org's repository INVENTORY spans both providers, so
 * the Segmented switches the CONNECTION card above it rather than the page. A
 * second route would have needed a second registry entry for a row the design
 * draws once, and the totality test pairs entries with routes 1:1.
 *
 * `router.push` rather than `shallowPush`, per `CLAUDE.md`'s rule: the target body
 * needs data the browser does not have — the OTHER provider's connection.
 */
export function ProviderSwitch({
  active,
  hrefFor = (value) => `/settings/workspace/${value}`,
}: {
  active: Provider;
  hrefFor?: (value: Provider) => string;
}) {
  const t = useTranslations('git');
  const router = useRouter();

  return (
    <Segmented<Provider>
      label={t('provider.label')}
      value={active}
      onChange={(value) => router.push(hrefFor(value))}
      options={[
        { value: 'github', label: t('provider.github'), icon: <GithubMark /> },
        { value: 'gitlab', label: t('provider.gitlab'), icon: <GitlabMark /> },
      ]}
    />
  );
}
