export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uml, diagType, fmt, lang } = req.body;
  if (!uml) return res.status(400).json({ error: 'Content is required' });

  const diagLabel = {
    'use-case': 'Use Case Diagram', 'sequence': 'Sequence Diagram',
    'class': 'Class Diagram', 'activity': 'Activity Diagram', 'bpmn': 'BPMN Process Diagram'
  }[diagType] || 'Activity Diagram';

  const fmtLabel = {
    'auto': 'auto-detected', 'mermaid': 'Mermaid',
    'plantuml': 'PlantUML', 'camunda-xml': 'Camunda BPMN XML'
  }[fmt] || 'auto-detected';

  const langLabel = {
    'az': 'Azerbaijani', 'en': 'English', 'ru': 'Russian', 'tr': 'Turkish'
  }[lang] || 'Azerbaijani';

  const isBpmn = diagType === 'bpmn' || fmt === 'camunda-xml';

  let processedUml = uml;
  if (uml.length > 8000) {
    const lines = uml.split('\n');
    const keep = lines.filter(l => {
      const t = l.trim();
      return (
        t.includes('name=') || t.includes('id=') ||
        t.match(/userTask|serviceTask|scriptTask|sendTask|receiveTask|manualTask|businessRuleTask/) ||
        t.match(/startEvent|endEvent|intermediateCatch|intermediateThrow|boundaryEvent/) ||
        t.match(/exclusiveGateway|parallelGateway|inclusiveGateway|eventBasedGateway/) ||
        t.match(/sequenceFlow|messageFlow|subProcess|callActivity/) ||
        t.match(/lane|Lane|participant|pool|Pool/) ||
        t.match(/\|[^|]+\|/) ||
        t.match(/^\s*(if|else|elseif|repeat|while|fork|split|:)/)
      );
    });
    processedUml = keep.join('\n');
    if (processedUml.length > 8000) processedUml = processedUml.slice(0, 8000);
  }

  const prompt = `You are a senior business analyst specializing in ${isBpmn ? 'BPMN/Camunda process analysis' : 'UML diagram analysis'}.
Extract Acceptance Criteria from the diagram below. Output ONLY a valid JSON array. No explanation, no markdown, no code fences. Start with [ end with ].

JSON format:
[{"id":"AC-001","title":"step title","priority":"High|Medium|Low","element_type":"task|gateway|event|subprocess|lane","diagram_element":"exact name","acceptance_criteria":["Given [pre] When [action] Then [result]"]}]

Rules: 1 item per main task/gateway/event, 3-5 AC each, strict GIVEN-WHEN-THEN, for gateways cover each branch, short testable sentences. Output in ${langLabel}.

Diagram (${diagLabel}, format: ${fmtLabel}):
${processedUml}`;

  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;
  const model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are a business analyst. Output ONLY valid JSON arrays. No markdown, no explanation.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 4000,
          temperature: 0.1
        })
      }
    );

    const txt = await response.text();
    if (!response.ok) {
      let msg = 'Cloudflare HTTP ' + response.status;
      try { msg = JSON.parse(txt).errors?.[0]?.message || msg; } catch {}
      return res.status(500).json({ error: msg });
    }

    const data = JSON.parse(txt);
    const raw = data?.result?.response || '';
    if (!raw.trim()) return res.status(500).json({ error: 'Model bos cavab qaytardi' });

    const start = raw.indexOf('['), end = raw.lastIndexOf(']');
    if (start === -1 || end === -1) return res.status(500).json({ error: 'JSON tapilmadi', raw: raw.slice(0, 200) });

    let jsonStr = raw.slice(start, end + 1)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/,(\s*[}\]])/g, '$1');

    let items;
    try {
      items = JSON.parse(jsonStr);
    } catch {
      const lastComplete = jsonStr.lastIndexOf('},');
      if (lastComplete > 0) {
        try { items = JSON.parse(jsonStr.slice(0, lastComplete + 1) + ']'); } catch {
          return res.status(500).json({ error: 'JSON parse xetasi' });
        }
      } else {
        return res.status(500).json({ error: 'JSON parse xetasi' });
      }
    }

    if (!Array.isArray(items) || !items.length) return res.status(500).json({ error: 'Bos array' });
    return res.status(200).json({ items });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
