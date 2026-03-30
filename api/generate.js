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
    'az': { given: 'Verilmişdir', when: 'Nə zaman', then: 'Onda' },
    'en': { given: 'Given', when: 'When', then: 'Then' },
    'ru': { given: 'Дано', when: 'Когда', then: 'Тогда' },
    'tr': { given: 'Verildiğinde', when: 'Ne zaman', then: 'O zaman' }
  }[lang] || { given: 'Given', when: 'When', then: 'Then' };

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

  const { given, when, then } = langKeywords;

  const systemPrompt = `You are a senior Business Analyst with deep expertise in writing Acceptance Criteria using the Gherkin BDD format (Given-When-Then).

Your task: Analyze the provided ${isBpmn ? 'BPMN/Camunda' : 'UML'} diagram and extract professional Acceptance Criteria for EVERY task, gateway, event, and subprocess.

CRITICAL RULES FOR ACCEPTANCE CRITERIA:
1. Every AC must follow STRICT format: "${given} [precondition/context] ${when} [action/trigger] ${then} [expected outcome]"
2. "${given}" = the initial context or precondition before the action
3. "${when}" = the specific action, event, or trigger that occurs  
4. "${then}" = the measurable, verifiable expected result
5. Each AC must be testable by a QA engineer
6. Cover ALL paths: happy path, alternative flows, error cases, gateway branches
7. For gateways: write separate AC for EACH decision branch
8. For error events: write AC covering what happens when error occurs
9. Language: Write ALL text values in ${langLabel} language ONLY
10. No apostrophes or special quotes inside JSON string values

OUTPUT: Return ONLY a raw JSON array. Zero explanation. Zero markdown. Start directly with [

JSON structure:
[
  {
    "id": "AC-001",
    "title": "descriptive title in ${langLabel}",
    "priority": "High|Medium|Low",
    "element_type": "task|gateway|event|subprocess|lane|startEvent|endEvent|userTask|serviceTask",
    "diagram_element": "exact element name from diagram",
    "acceptance_criteria": [
      "${given} [context] ${when} [action] ${then} [result]",
      "${given} [context] ${when} [action] ${then} [result]",
      "${given} [context] ${when} [action] ${then} [result]"
    ]
  }
]`;

  const userMsg = `Analyze this ${diagLabel} (format: ${fmtLabel}) completely and extract Acceptance Criteria for EVERY element.

Cover the ENTIRE end-to-end process. Do not skip any task, gateway, or event.
Write all text in ${langLabel} language.
Each acceptance_criteria item MUST start with "${given}", "${when}", or "${then}" keyword.

Diagram:
${processedUml}`;

  try {
    const response = await fetch(
      'https://api-inference.huggingface.co/models/Qwen/Qwen2.5-72B-Instruct/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.HF_API_TOKEN}`
        },
        body: JSON.stringify({
          model: 'Qwen/Qwen2.5-72B-Instruct',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg }
          ],
          max_tokens: 6000,
          temperature: 0.1,
          stream: false
        })
      }
    );

    const txt = await response.text();
    if (!response.ok) {
      let msg = 'HTTP ' + response.status;
      try { msg = JSON.parse(txt).error || msg; } catch {}
      return res.status(500).json({ error: msg });
    }

    const data = JSON.parse(txt);
    const raw = data?.choices?.[0]?.message?.content || '';
    if (!raw || !raw.trim()) return res.status(500).json({ error: 'Model bos cavab qaytardi' });

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
        try {
          items = JSON.parse(jsonStr.slice(0, lastComplete + 1) + ']');
        } catch {
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
