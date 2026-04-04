export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { items, jiraDomain, jiraEmail, jiraToken, projectKey } = req.body;

  if (!items?.length) return res.status(400).json({ error: 'AC items tələb olunur' });
  if (!jiraDomain || !jiraEmail || !jiraToken || !projectKey) {
    return res.status(400).json({ error: 'Jira məlumatları tamamlanmayıb' });
  }

  const base64 = Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');
  const headers = {
    'Authorization': `Basic ${base64}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  const baseUrl = `https://${jiraDomain.replace(/https?:\/\//, '')}/rest/api/3`;

  // AC-ları lane-ə görə qruplaşdır
  const groups = {};
  for (const item of items) {
    const lane = item.lane || 'Ümumi';
    if (!groups[lane]) groups[lane] = [];
    groups[lane].push(item);
  }

  const created = [];
  const errors = [];

  for (const [lane, laneItems] of Object.entries(groups)) {
    // Description - ADF formatında
    const acContent = laneItems.map(item => {
      const criteriaNodes = (item.acceptance_criteria || []).map((ac, i) => ({
        type: 'listItem',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: ac }]
        }]
      }));

      return [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: `${item.id} — ${item.title}`, marks: [{ type: 'strong' }] }]
        },
        {
          type: 'orderedList',
          content: criteriaNodes
        }
      ];
    }).flat();

    const description = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{
            type: 'text',
            text: `Rol: ${lane}`,
            marks: [{ type: 'strong' }]
          }]
        },
        {
          type: 'rule'
        },
        ...acContent,
        {
          type: 'paragraph',
          content: [{
            type: 'text',
            text: '— AC Generator tərəfindən avtomatik yaradılıb',
            marks: [{ type: 'em' }]
          }]
        }
      ]
    };

    const issueBody = {
      fields: {
        project: { key: projectKey },
        summary: `[${lane}] Acceptance Criteria`,
        description,
        issuetype: { name: 'Story' },
        labels: ['ac-generator']
      }
    };

    try {
      const response = await fetch(`${baseUrl}/issue`, {
        method: 'POST',
        headers,
        body: JSON.stringify(issueBody)
      });

      const data = await response.json();

      if (!response.ok) {
        errors.push({ lane, error: data.errorMessages?.[0] || data.errors || `HTTP ${response.status}` });
      } else {
        created.push({
          lane,
          issueKey: data.key,
          url: `https://${jiraDomain.replace(/https?:\/\//, '')}/browse/${data.key}`,
          count: laneItems.length
        });
      }
    } catch (err) {
      errors.push({ lane, error: err.message });
    }
  }

  return res.status(200).json({ created, errors });
}
