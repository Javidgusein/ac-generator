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

  const systemPrompt = `You are a senior business analyst specializing in ${isBpmn ? 'BPMN/Camunda process analysis' : 'UML diagram analysis'}. Extract Acceptance Criteria from diagrams. Output ONLY a valid JSON array. No explanation, no markdown, no code fences. Start with [ end with ]. IMPORTANT: Use only double quotes in JSON. Never use single quotes, apostrophes, or special characters inside string values.`;

  const userMsg = `Analyze this ${diagLabel} (format: ${fmtLabel}). Output in ${langLabel}.

JSON format:
[{"id":"AC-001","title":"step title","priority":"High|Medium|Low","element_type":"task|gateway|event|subprocess|lane","diagram_element":"exact name","acceptance_criteria":["Given [pre] When [action] Then [result]"]}]

Rules:
- 1 item per main task/gateway/event
- 3-5 AC each in strict GIVEN-WHEN-THEN format
- For gateways cover each branch
- Short testable sentences
- NO apostrophes or special chars in text values
- Output ONLY the JSON array, nothing else

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
        model: 'openrouter/auto',
        temperature: 0.1,
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
    if (!raw.trim()) return res.status(500).json({ error: 'Model bos cavab qaytardi' });

    // Extract JSON array
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end === -1) {
      return res.status(500).json({ error: 'JSON tapilmadi', raw: raw.slice(0, 300) });
    }

    let jsonStr = raw.slice(start, end + 1);

    // Clean common JSON issues from LLM output
    jsonStr = jsonStr
      .replace(/[\u0000-\u001F\u007F]/g, ' ') // remove control characters
      .replace(/,\s*}/g, '}')                  // trailing commas in objects
      .replace(/,\s*]/g, ']')                  // trailing commas in arrays
      .replace(/\\'/g, "'")                    // escaped single quotes
      .replace(/([^\\])'/g, "$1\u2019");       // unescaped single quotes to curly apostrophe

    let items;
    try {
      items = JSON.parse(jsonStr);
    } catch (e) {
      // Last resort: try to extract individual objects
      return res.status(500).json({ 
        error: 'JSON parse xetasi: ' + e.message,
        raw: jsonStr.slice(0, 300)
      });
    }

    if (!Array.isArray(items) || !items.length) {
      return res.status(500).json({ error: 'Bos array qaytarildi' });
    }

    return res.status(200).json({ items });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
