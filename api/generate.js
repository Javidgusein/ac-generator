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

  // For large BPMN/XML files, extract only element names to reduce tokens
  let processedUml = uml;
  if (uml.length > 8000) {
    const lines = uml.split('\n');
    const keep = lines.filter(l => {
      const t = l.trim();
      return (
        t.includes('name=') || t.includes('id=') ||
        t.match(/userTask|serviceTask|scriptTask|sendTask|receiveTask|manualTask|businessRuleTask/) ||
        t.match(/startEvent|endEvent|intermediateCatch|intermediateThrow|boundaryEvent/) ||
        t.match(/exclusiveGateway|parallelGateway|inclusiveGateway|eventBasedGateway|complexGateway/) ||
        t.match(/sequenceFlow|messageFlow|subProcess|callActivity/) ||
        t.match(/lane|Lane|participant|Participant|pool|Pool/) ||
        t.match(/\|[^|]+\|/) || // PlantUML swimlanes
        t.match(/^\s*(if|else|elseif|repeat|while|fork|split|:)/) // PlantUML activity
      );
    });
    processedUml = keep.join('\n');
    if (processedUml.length > 8000) processedUml = processedUml.slice(0, 8000);
  }

  const systemPrompt = `You are a senior business analyst. Extract Acceptance Criteria from ${isBpmn ? 'BPMN/Camunda' : 'UML'} diagrams.
Output ONLY a raw JSON array. No markdown, no explanation, no code fences.
Keep each acceptance_criteria item SHORT (max 15 words). Use only ASCII characters in values.`;

  const userMsg = `Analyze this ${diagLabel} (${fmtLabel}). Output in ${langLabel}.

Output format (raw JSON array only):
[{"id":"AC-001","title":"title","priority":"High","element_type":"task","diagram_element":"name","acceptance_criteria":["Given X When Y Then Z"]}]

Rules:
- 1 object per main task or gateway
- 3 acceptance_criteria per object maximum
- GIVEN-WHEN-THEN format, max 15 words each
- No apostrophes, no quotes inside text values
- Output the JSON array only, nothing before or after

Diagram:
${processedUml}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://ac-generator-blond.vercel.app',
        'X-Title': 'AC Generator'
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        temperature: 0.1,
        max_tokens: 6000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg }
        ]
      })
    });

    const txt = await response.text();
    if (!response.ok) {
      let msg = 'HTTP ' + response.status;
      try { msg = JSON.parse(txt).error?.message || msg; } catch {}
      return res.status(500).json({ error: msg });
    }

    const data = JSON.parse(txt);
    const raw = data?.choices?.[0]?.message?.content || '';
    if (!raw.trim()) return res.status(500).json({ error: 'Model bos cavab qaytardi' });

    // Find JSON array boundaries
    const start = raw.indexOf('[');
    let end = raw.lastIndexOf(']');
    if (start === -1) return res.status(500).json({ error: 'JSON array tapilmadi', raw: raw.slice(0, 200) });

    let jsonStr = raw.slice(start, end + 1);

    // Clean LLM JSON artifacts
    jsonStr = jsonStr
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')  // control chars except \t\n\r
      .replace(/,(\s*[}\]])/g, '$1')                        // trailing commas
      .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');       // unquoted keys

    // Try to parse, if fails try to recover truncated JSON
    let items;
    try {
      items = JSON.parse(jsonStr);
    } catch (e1) {
      // Try to recover: find last complete object
      const lastComplete = jsonStr.lastIndexOf('},');
      if (lastComplete > 0) {
        const recovered = jsonStr.slice(0, lastComplete + 1) + ']';
        try {
          items = JSON.parse(recovered);
        } catch (e2) {
          return res.status(500).json({
            error: 'JSON parse edilemedi. Fayl cox boyukdur, bolub ayri-ayri gonderin.',
            detail: e1.message
          });
        }
      } else {
        return res.status(500).json({
          error: 'JSON parse edilemedi: ' + e1.message,
          raw: jsonStr.slice(0, 200)
        });
      }
    }

    if (!Array.isArray(items) || !items.length) {
      return res.status(500).json({ error: 'Bos array qaytarildi' });
    }

    return res.status(200).json({ items });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
