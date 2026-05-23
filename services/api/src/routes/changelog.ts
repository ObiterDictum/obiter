import { Hono } from 'hono'

interface GitHubRelease {
  html_url: string
  name: string | null
  published_at: string | null
  tag_name: string
}

interface GitHubCommit {
  html_url: string
  commit: {
    author?: {
      date?: string
    } | null
    message: string
  }
  sha: string
}

function releaseEntry(release: GitHubRelease) {
  return {
    date: release.published_at?.slice(0, 10) ?? null,
    title: release.name ?? release.tag_name,
    url: release.html_url,
  }
}

function commitEntry(commit: GitHubCommit) {
  return {
    date: commit.commit.author?.date?.slice(0, 10) ?? null,
    title: commit.commit.message.split('\n')[0] ?? commit.sha.slice(0, 7),
    url: commit.html_url,
  }
}

export function createChangelogRoutes() {
  const app = new Hono()

  app.get('/api/changelog', async (c) => {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ormont-api',
    }

    const releasesResponse = await fetch(
      'https://api.github.com/repos/OrmontLex/ormont/releases?per_page=5',
      { headers },
    )

    if (releasesResponse.ok) {
      const releases = (await releasesResponse.json()) as GitHubRelease[]
      if (releases.length > 0) {
        return c.json({ entries: releases.map(releaseEntry), source: 'github_releases' })
      }
    }

    const commitsResponse = await fetch(
      'https://api.github.com/repos/OrmontLex/ormont/commits?sha=dev&per_page=5',
      { headers },
    )

    if (!commitsResponse.ok) {
      return c.json({ entries: [], source: 'github_unavailable' }, 503)
    }

    const commits = (await commitsResponse.json()) as GitHubCommit[]
    return c.json({ entries: commits.map(commitEntry), source: 'github_commits' })
  })

  return app
}
