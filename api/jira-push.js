export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { items, groups, groupingMethod, jiraDomain, jiraEmail, jiraToken, projectKey } = req.body;

  if (!items?.length) return res.status(400).json({ error: 'AC items tələb olunur' });
  if (!jiraDomain || !jiraEmail || !jiraToken || !projectKey)
    return res.status(400).json({ error: 'Jira məlumatları tamamlanmayıb' });

  const base64 = Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');
  const headers = { 'Authorization': `Basic ${base64}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
  const domain = jiraDomain.replace(/https?:\/\//, '');
  const baseUrl = `https://${domain}/rest/api/3`;

  // ─── Qruplaşdırma məntiqi ──────────────────────────────────────────────
  let finalGroups = [];

  if (groupingMethod === 'manual') {
    finalGroups = (groups || []).filter(g => g.items?.length > 0).map(g => ({
      name: g.name,
      items: g.items
    }));

  } else if (groupingMethod === 'lane') {
    const laneMap = {};
    for (const item of items) {
      const lane = item.lane || 'Ümumi';
      if (!laneMap[lane]) laneMap[lane] = [];
      laneMap[lane].push(item);
    }
    finalGroups = Object.entries(laneMap).map(([lane, laneItems]) => ({
      name: lane,
      items: laneItems
    }));

  } else if (groupingMethod === 'ai') {
    // Claude ilə AI qruplaşdırma
    const acSummary = items.map(i => `${i.id}: ${i.title} — ${(i.acceptance_criteria || []).join(' | ')}`).join('\n');
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.Claude_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: 'You are a senior BA. Group the given AC items into logical User Story groups. Output ONLY a raw JSON array. No markdown.',
        messages: [{
          role: 'user',
          content: `Group these ACs into logical User Stories. Each group should have a meaningful name.\n\n${acSummary}\n\nJSON format:\n[{"name":"Group name","ids":["AC-001","AC-002"]}]`
        }]
      })
    });
    const aiData = await aiRes.json();
    const rawText = (aiData.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const start = rawText.indexOf('['), end = rawText.lastIndexOf(']');
    if (start !== -1 && end !== -1) {
      try {
        const aiGroups = JSON.parse(rawText.slice(start, end + 1));
        finalGroups = aiGroups.map(g => ({
          name: g.name,
          items: (g.ids || []).map(id => items.find(i => i.id === id)).filter(Boolean)
        })).filter(g => g.items.length > 0);
      } catch { /* fallback to lane */ }
    }
    if (!finalGroups.length) {
      finalGroups = [{ name: 'Acceptance Criteria', items }];
    }
  }

  if (!finalGroups.length) return res.status(400).json({ error: 'Qruplar boşdur' });

  // ─── Jira Story-lər yarat ──────────────────────────────────────────────
  const created = [], errors = [];

  for (const group of finalGroups) {
    const acContent = group.items.map(item => {
      const criteriaNodes = (item.acceptance_criteria || []).map(ac => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: ac }] }]
      }));
      return [
        { type: 'paragraph', content: [{ type: 'text', text: `${item.id} — ${item.title}`, marks: [{ type: 'strong' }] }] },
        { type: 'orderedList', content: criteriaNodes }
      ];
    }).flat();

    const description = {
      type: 'doc', version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: `User Story: ${group.name}`, marks: [{ type: 'strong' }] }] },
        { type: 'rule' },
        ...acContent,
        { type: 'paragraph', content: [{ type: 'text', text: '— AC Generator tərəfindən yaradılıb', marks: [{ type: 'em' }] }] }
      ]
    };

    try {
      const response = await fetch(`${baseUrl}/issue`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fields: {
            project: { key: projectKey },
            summary: group.name,
            description,
            issuetype: { name: 'Story' },
            labels: ['ac-generator']
          }
        })
      });
      const data = await response.json();
      if (!response.ok) {
        errors.push({ lane: group.name, error: data.errorMessages?.[0] || `HTTP ${response.status}` });
      } else {
        created.push({ lane: group.name, issueKey: data.key, url: `https://${domain}/browse/${data.key}`, count: group.items.length });
      }
    } catch (err) {
      errors.push({ lane: group.name, error: err.message });
    }
  }

  return res.status(200).json({ created, errors });
}
