const fs = require('fs');

const REPO = process.env.REPO; // owner/name
const LATEST_TAG = process.env.LATEST_TAG;
const GH_TOKEN = process.env.GH_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const [owner, repo] = REPO.split('/');

const GH_HEADERS = {
  Authorization: `Bearer ${GH_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'release-notes-bot'
};

async function ghJson(url) {
  const res = await fetch(url, { headers: GH_HEADERS });
  if (!res.ok) throw new Error(`GitHub API error ${res.status} for ${url}`);
  return res.json();
}

async function ghDiff(prNumber) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
    headers: { ...GH_HEADERS, Accept: 'application/vnd.github.v3.diff' }
  });
  if (!res.ok) return '';
  return res.text();
}

async function getSinceDate() {
  if (LATEST_TAG === 'v0.0.0') return '2000-01-01';
  const tagData = await ghJson(`https://api.github.com/repos/${owner}/${repo}/commits/${LATEST_TAG}`);
  return tagData.commit.committer.date;
}

async function getMergedPRs(sinceDate) {
  const q = `repo:${owner}/${repo}+is:pr+is:merged+base:main+merged:>${sinceDate}`;
  const data = await ghJson(`https://api.github.com/search/issues?q=${q}&sort=created&order=asc`);
  return data.items || [];
}

const CATEGORY_TITLES = {
  functionality: '⚙️ Functionality Changes',
  performance: '⚡ Performance Improvements',
  noop: '🚫 No Functional Change',
  maintenance: '🧰 Maintenance'
};

async function classifyWithClaude(pr, diff) {
  const truncatedDiff = diff.length > 6000 ? diff.slice(0, 6000) + '\n... (diff truncated)' : diff;
  const prompt = `You are writing a changelog entry for a merged pull request. Base your analysis strictly on the actual code diff below - do not assume improvements that the diff does not support. If the diff is empty, whitespace-only, or otherwise has no material effect on behavior or performance, say so honestly instead of inventing an improvement.

PR title: ${pr.title}
PR number: #${pr.number}
PR description: ${pr.body || '(none)'}

Diff:
${truncatedDiff}

Respond with ONLY valid JSON in this exact shape, no markdown fences:
{"category": "functionality" | "performance" | "noop" | "maintenance", "description": "one to two sentence, diff-grounded description"}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Anthropic API error for PR #${pr.number}: ${res.status} ${errText}`);
    return { category: 'maintenance', description: pr.title };
  }

  const data = await res.json();
  const text = data.content?.[0]?.text?.trim() || '';
  try {
    const parsed = JSON.parse(text);
    if (!CATEGORY_TITLES[parsed.category]) parsed.category = 'maintenance';
    return parsed;
  } catch (e) {
    console.error(`Could not parse Claude response for PR #${pr.number}: ${text}`);
    return { category: 'maintenance', description: pr.title };
  }
}

async function main() {
  const sinceDate = await getSinceDate();
  const prs = await getMergedPRs(sinceDate);

  const grouped = { functionality: [], performance: [], noop: [], maintenance: [] };

  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set - falling back to plain PR titles under Maintenance.');
    for (const pr of prs) {
      grouped.maintenance.push(`- ${pr.title} (#${pr.number}) by @${pr.user.login}`);
    }
  } else {
    for (const pr of prs) {
      const diff = await ghDiff(pr.number);
      const result = await classifyWithClaude(pr, diff);
      grouped[result.category].push(`- **${pr.title}** (#${pr.number}) by @${pr.user.login} — ${result.description}`);
    }
  }

  let body = "## What's Changed\n\n";
  let any = false;
  for (const key of ['functionality', 'performance', 'noop', 'maintenance']) {
    if (grouped[key].length) {
      any = true;
      body += `### ${CATEGORY_TITLES[key]}\n${grouped[key].join('\n')}\n\n`;
    }
  }
  if (!any) {
    body += '_No merged pull requests found since the last release._\n';
  }

  fs.writeFileSync('release_notes.md', body);
  console.log(body);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
