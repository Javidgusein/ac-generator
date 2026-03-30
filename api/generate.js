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

  const systemPrompt = `You are a senior Business Analyst with 10+ years of enterprise software experience. You write professional Acceptance Criteria that QA engineers can directly use for test case creation.

THINKING PROCESS - before writing each AC, ask yourself:
1. What is the BUSINESS PURPOSE of this element? What real-world action does it represent?
2. Who is the ACTOR? (user, system, admin, external service?)
3. What are the PRECONDITIONS needed before this step can happen?
4. What SPECIFIC ACTION triggers this step?
5. What is the MEASURABLE OUTCOME - what exactly changes in the system?
6. What are the ALTERNATIVE PATHS? (error cases, gateway branches, edge cases)

RULES FOR QUALITY AC:
- Each AC describes a DIFFERENT business scenario or edge case
- Never copy the element name into the AC text - explain what it MEANS
- For gateways: write one AC per each branch showing the decision logic
- For tasks: write AC for happy path, validation, and error scenario
- For events: write AC for trigger condition and system response
- Be SPECIFIC: mention exact system behaviors, not vague descriptions
- AC must be TESTABLE: a QA engineer must be able to write a test from it

LANGUAGE: Write ALL text in ${langLabel} only.
OUTPUT: Raw JSON array only. No markdown. No explanation. Start with [ end with ].
No apostrophes inside string values.`;

  const userMsg = `Analyze this ${diagLabel} (${fmtLabel}) and write professional Acceptance Criteria for EVERY element.

IMPORTANT QUALITY CHECKS before outputting:
- Does each AC tell a UNIQUE story? If two ACs say similar things, rewrite one.
- Does each AC reflect the REAL business logic, not just the element name?
- For gateway elements: does each branch have its own AC with the specific condition?
- Are all ACs testable by a QA engineer without needing more information?

JSON format:
[{
  "id": "AC-001",
  "title": "business-meaningful title in ${langLabel}",
  "priority": "High|Medium|Low",
  "element_type": "userTask|serviceTask|exclusiveGateway|parallelGateway|startEvent|endEvent|boundaryEvent|subprocess|lane",
  "diagram_element": "exact element name from diagram",
  "acceptance_criteria": [
    "${given} [specific business context] ${when} [specific user or system action] ${then} [specific measurable system response]",
    "${given} [different context] ${when} [different action or condition] ${then} [different outcome]",
    "${given} [error or edge case context] ${when} [trigger for edge case] ${then} [how system handles it]"
  ]
}]

Write in ${langLabel}. Output JSON array only.

Diagram:
${processedUml}`;

  const models = [
    'openrouter/auto',
    'meta-llama/llama-3.3-70b-instruct:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
    'google/gemma-3-27b-it:free'
  ];

  let lastError = null;

  for (const model of models) {
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
          model,
          temperature: 0.2,
          max_tokens: 6000,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg }
          ]
        })
      });

      const txt = await response.text();

      if (!txt || txt.trim().startsWith('<') || txt.trim().startsWith('A server')) {
        lastError = new Error('Server xetasi: ' + txt.slice(0, 80));
        continue;
      }

      if (!response.ok) {
        let msg = 'HTTP ' + response.status;
        try { msg = JSON.parse(txt).error?.message || msg; } catch {}
        lastError = new Error(msg);
        continue;
      }

      let data;
      try { data = JSON.parse(txt); } catch {
        lastError = new Error('Response parse xetasi');
        continue;
      }

      const raw = data?.choices?.[0]?.message?.content || '';
      if (!raw.trim()) { lastError = new Error('Bos cavab'); continue; }

      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      if (start === -1 || end === -1) { lastError = new Error('JSON tapilmadi'); continue; }

      let jsonStr = raw.slice(start, end + 1)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/,(\s*[}\]])/g, '$1')
        .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');

      let items;
      try {
        items = JSON.parse(jsonStr);
      } catch {
        const lastComplete = jsonStr.lastIndexOf('},');
        if (lastComplete > 0) {
          try { items = JSON.parse(jsonStr.slice(0, lastComplete + 1) + ']'); } catch {
            lastError = new Error('JSON parse xetasi');
            continue;
          }
        } else {
          lastError = new Error('JSON parse xetasi');
          continue;
        }
      }

      if (!Array.isArray(items) || !items.length) {
        lastError = new Error('Bos array');
        continue;
      }

      return res.status(200).json({ items });

    } catch (err) {
      lastError = err;
      continue;
    }
  }

  return res.status(500).json({
    error: 'Butun modeller xeta verdi. Bir az gozleyib yeniden ced edin.',
    detail: lastError?.message
  });
}
