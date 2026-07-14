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

// Shown when a release has no PRs at all in that category, so the section
// is never silently dropped - readers can always see the performance/
// functionality status of a release, even when nothing changed there.
const EMPTY_CATEGORY_NOTES = {
  functionality: '_No functionality-related changes in this release._',
  performance: '_No performance-related changes in this release — performance was neither increased nor decreased._'
};

async function classifyWithClaude(pr, diff) {
  const truncatedDiff = diff.length > 6000 ? diff.slice(0, 6000) + '\n... (diff truncated)' : diff;
  const prompt = `You are writing a changelog entry for a merged pull request. Base your analysis strictly on the actual code diff below - do not assume improvements that the diff does not support. If the diff is empty, whitespace-only, or otherwise has no material effect on behavior or performance, say so honestly instead of inventing an improvement.

PR title: ${pr.title}
PR number: #${pr.number}
PR description: ${pr.body || '(none)'}

Diff:
${truncatedDiff}

Also assess performance impact specifically: state whether this diff increases, decreases, or has no effect on performance, and briefly why.

Respond with ONLY valid JSON in this exact shape, no markdown fences:
{"category": "functionality" | "performance" | "noop" | "maintenance", "description": "one to two sentence, diff-grounded description", "performance_impact": "increased" | "decreased" | "none", "performance_note": "one sentence explaining the performance_impact, grounded in the diff"}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Anthropic API error for PR #${pr.number}: ${res.status} ${errText}`);
    return { category: 'maintenance', description: pr.title, performance_impact: 'none', performance_note: 'Not assessed - Claude API call failed.' };
  }

  const data = await res.json();
  const text = data.content?.[0]?.text?.trim() || '';
  try {
    const parsed = JSON.parse(text);
    if (!CATEGORY_TITLES[parsed.category]) parsed.category = 'maintenance';
    if (!['increased', 'decreased', 'none'].includes(parsed.performance_impact)) parsed.performance_impact = 'none';
    return parsed;
  } catch (e) {
    console.error(`Could not parse Claude response for PR #${pr.number}: ${text}`);
    return { category: 'maintenance', description: pr.title, performance_impact: 'none', performance_note: 'Not assessed - could not parse model response.' };
  }
}

async function main() {
  const sinceDate = await getSinceDate();
  const prs = await getMergedPRs(sinceDate);

  const grouped = { functionality: [], performance: [], noop: [], maintenance: [] };
  const performanceNotes = [];

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
      if (result.performance_impact && result.performance_impact !== 'none') {
        performanceNotes.push(`- **${pr.title}** (#${pr.number}): performance ${result.performance_impact} — ${result.performance_note}`);
      }
    }
  }

  let body = "## What's Changed\n\n";

  // Functionality: always shown, with an explicit note when there's nothing to report.
  body += `### ${CATEGORY_TITLES.functionality}\n`;
  body += grouped.functionality.length ? grouped.functionality.join('\n') : EMPTY_CATEGORY_NOTES.functionality;
  body += '\n\n';

  // Performance: always shown. Combines any PRs classified as "performance"
  // plus the per-PR performance_impact assessment gathered from every PR,
  // so a release with e.g. only a functionality PR still states clearly
  // that performance was unaffected, rather than omitting the section.
  body += `### ${CATEGORY_TITLES.performance}\n`;
  if (grouped.performance.length || performanceNotes.length) {
    if (grouped.performance.length) body += grouped.performance.join('\n') + '\n';
    if (performanceNotes.length) body += performanceNotes.join('\n') + '\n';
  } else {
    body += EMPTY_CATEGORY_NOTES.performance;
  }
  body += '\n\n';

  // No-functional-change and Maintenance sections are only shown when relevant.
  if (grouped.noop.length) {
    body += `### ${CATEGORY_TITLES.noop}\n${grouped.noop.join('\n')}\n\n`;
  }
  if (grouped.maintenance.length) {
    body += `### ${CATEGORY_TITLES.maintenance}\n${grouped.maintenance.join('\n')}\n\n`;
  }

  if (!prs.length) {
    body += '_No merged pull requests found since the last release._\n';
  }

  fs.writeFileSync('release_notes.md', body);
  console.log(body);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
