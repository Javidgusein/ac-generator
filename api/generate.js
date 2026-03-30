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

  const systemPrompt = `You are a senior business analyst specializing in ${isBpmn ? 'BPMN/Camunda process analysis' : 'UML diagram analysis'}. Extract Acceptance Criteria from diagrams. Output ONLY a valid JSON array. No explanation, no markdown, no code fences. Start with [ end with ].`;

  const userMsg = `Analyze this ${diagLabel} (format: ${fmtLabel}). Output in ${langLabel}.

JSON format:
[{"id":"AC-001","title":"step title","priority":"High|Medium|Low","element_type":"task|gateway|event|subprocess|lane","diagram_element":"exact name","acceptance_criteria":["Given [pre] When [action] Then [result]"]}]

Rules: 1 item per main task/gateway/event, 3-5 AC each, strict GIVEN-WHEN-THEN, for gateways cover each branch, short testable sentences.

Diagram:
${uml}`;

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
        model: 'meta-llama/llama-3.3-70b-instruct:free',
        temperature: 0.2,
        max_tokens: 4000,
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
    if (!raw.trim()) return res.status(500).json({ error: 'Model boş cavab qaytardı' });

    const start = raw.indexOf('['), end = raw.lastIndexOf(']');
    if (start === -1 || end === -1) return res.status(500).json({ error: 'JSON tapılmadı', raw: raw.slice(0, 200) });

    const items = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(items) || !items.length) return res.status(500).json({ error: 'Boş array' });

    return res.status(200).json({ items });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
