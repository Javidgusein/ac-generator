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

  const langKeywords = {
    'az': { given: 'Verilmishdir', when: 'Ne zaman ki', then: 'Onda' },
    'en': { given: 'Given', when: 'When', then: 'Then' },
    'ru': { given: 'Dano', when: 'Kogda', then: 'Togda' },
    'tr': { given: 'Verildiginde', when: 'Ne zaman', then: 'O zaman' }
  }[lang] || { given: 'Given', when: 'When', then: 'Then' };

  const { given, when, then } = langKeywords;
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
        t.match(/exclusiveGateway|parallelGateway|inclusiveGateway|eventBasedGateway|complexGateway/) ||
        t.match(/sequenceFlow|messageFlow|subProcess|callActivity/) ||
        t.match(/lane|Lane|participant|Participant|pool|Pool/) ||
        t.match(/\|[^|]+\|/) ||
        t.match(/^\s*(if|else|elseif|repeat|while|fork|split|:)/)
      );
    });
    processedUml = keep.join('\n');
    if (processedUml.length > 8000) processedUml = processedUml.slice(0, 8000);
  }

  const systemPrompt = `You are a senior Business Analyst with 10+ years of experience writing Acceptance Criteria in Gherkin BDD format for enterprise software projects.

YOUR MISSION: Analyze the provided diagram and extract COMPLETE, PROFESSIONAL Acceptance Criteria for EVERY single element.

ABSOLUTE RULES - NEVER BREAK THESE:
1. OUTPUT: Only a raw JSON array. Zero explanation. Zero markdown. Zero code fences. Start with [ end with ]
2. COMPLETENESS: Extract AC for EVERY task, gateway, event, subprocess, lane - do not skip any element
3. UNIQUENESS: Every single AC item must be completely different - NEVER repeat the same sentence
4. FORMAT: Every AC must follow EXACTLY: "${given} [specific precondition] ${when} [specific trigger/action] ${then} [specific measurable outcome]"
   - ${given} = the exact system state or user context BEFORE the action
   - ${when} = the precise user action OR system event that occurs
   - ${then} = the specific, testable system response or business outcome
5. LANGUAGE: Write ALL title and acceptance_criteria text in ${langLabel} ONLY
6. COVERAGE: For gateways write separate AC for EACH branch/path
7. QUALITY: Each AC must be testable by a QA engineer - avoid vague statements
8. COUNT: Write exactly 4-5 AC per element - no more, no less`;

  const userMsg = `Analyze this COMPLETE ${diagLabel} (format: ${fmtLabel}) from start to finish.

CRITICAL: The number of AC objects must be the SAME regardless of output language. Do not produce fewer items in ${langLabel} than you would in English.

For EVERY element in the diagram create one JSON object. Cover the full end-to-end flow.

JSON format (strict):
[
  {
    "id": "AC-001",
    "title": "descriptive title of the element in ${langLabel}",
    "priority": "High|Medium|Low",
    "element_type": "userTask|serviceTask|exclusiveGateway|parallelGateway|startEvent|endEvent|boundaryEvent|subprocess|lane",
    "diagram_element": "exact element name as it appears in diagram",
    "acceptance_criteria": [
      "${given} [specific context] ${when} [specific action] ${then} [specific result]",
      "${given} [specific context] ${when} [specific action] ${then} [specific result]",
      "${given} [specific context] ${when} [specific action] ${then} [specific result]",
      "${given} [specific context] ${when} [specific action] ${then} [specific result]"
    ]
  }
]

DO NOT skip elements. DO NOT merge elements. DO NOT repeat AC text. Output JSON array only.

Diagram to analyze:
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
        max_tokens: 8000,
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

    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1) return res.status(500).json({ error: 'JSON tapilmadi', raw: raw.slice(0, 200) });

    let jsonStr = raw.slice(start, end + 1)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');

    let items;
    try {
      items = JSON.parse(jsonStr);
    } catch (e1) {
      const lastComplete = jsonStr.lastIndexOf('},');
      if (lastComplete > 0) {
        try {
          items = JSON.parse(jsonStr.slice(0, lastComplete + 1) + ']');
        } catch {
          return res.status(500).json({ error: 'JSON parse xetasi: ' + e1.message });
        }
      } else {
        return res.status(500).json({ error: 'JSON parse xetasi: ' + e1.message });
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
