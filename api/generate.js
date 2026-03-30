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

  // For large files extract only meaningful lines
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

  const systemPrompt = `You are a senior business analyst specializing in ${isBpmn ? 'BPMN/Camunda process analysis' : 'UML diagram analysis'}. Extract Acceptance Criteria from diagrams. Output ONLY a valid JSON array. No explanation, no markdown, no code fences. Start with [ end with ]. Use only double quotes. No apostrophes inside string values.`;

  const userMsg = `Analyze this ${diagLabel} (format: ${fmtLabel}). Output in ${langLabel}.

JSON format:
[{"id":"AC-001","title":"step title","priority":"High|Medium|Low","element_type":"task|gateway|event|subprocess|lane","diagram_element":"exact name","acceptance_criteria":["Given [pre] When [action] Then [result]"]}]

Rules: 1 item per main task/gateway/event, 3 acceptance_criteria max, GIVEN-WHEN-THEN format, short sentences, no special characters.

Diagram:
${processedUml}`;

  const callAPI = async () => {
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
      throw new Error(msg);
    }
    return JSON.parse(txt);
  };

  // Retry up to 3 times
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const data = await callAPI();
      const raw = data?.choices?.[0]?.message?.content || '';
      if (!raw.trim()) throw new Error('Empty response');

      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      if (start === -1 || end === -1) throw new Error('No JSON array found');

      let jsonStr = raw.slice(start, end + 1)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/,(\s*[}\]])/g, '$1');

      let items;
      try {
        items = JSON.parse(jsonStr);
      } catch {
        const lastComplete = jsonStr.lastIndexOf('},');
        if (lastComplete > 0) {
          items = JSON.parse(jsonStr.slice(0, lastComplete + 1) + ']');
        } else {
          throw new Error('JSON parse failed');
        }
      }

      if (!Array.isArray(items) || !items.length) throw new Error('Empty array');
      return res.status(200).json({ items });

    } catch (err) {
      lastError = err;
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }

  return res.status(500).json({ error: lastError?.message || 'Xəta baş verdi, yenidən cəhd edin' });
}
