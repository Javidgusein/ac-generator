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
  const { given, when, then } = langKeywords;

  let processedUml = uml;
  if (uml.length > 10000) {
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
    if (processedUml.length > 10000) processedUml = processedUml.slice(0, 10000);
  }

  const systemPrompt = `You are a senior Business Analyst expert in writing Acceptance Criteria using Gherkin BDD format.

STRICT RULES:
1. Extract AC for EVERY task, gateway, event, subprocess in the diagram
2. Each AC must be UNIQUE and MEANINGFUL - never repeat the same sentence
3. Each AC MUST follow: "${given} [specific precondition] ${when} [specific action] ${then} [specific measurable result]"
4. "${given}" = specific system state or user context before action
5. "${when}" = the exact user action or system trigger
6. "${then}" = the specific, verifiable system response or outcome
7. For gateways: write separate AC for EACH decision branch with specific condition
8. For error events: write AC for error scenario
9. ALL text must be in ${langLabel} language
10. Output ONLY raw JSON array, no markdown, no explanation`;

  const userMsg = `Analyze this ${diagLabel} (${fmtLabel}) end-to-end. Write Acceptance Criteria in ${langLabel} for every element.

IMPORTANT: Each acceptance criteria must describe a DIFFERENT, SPECIFIC scenario. Never write the same text twice.

JSON format:
[{"id":"AC-001","title":"element title in ${langLabel}","priority":"High|Medium|Low","element_type":"userTask|serviceTask|gateway|startEvent|endEvent|boundaryEvent|subprocess","diagram_element":"exact name from diagram","acceptance_criteria":["${given} [context] ${when} [action] ${then} [result]","${given} [context] ${when} [action] ${then} [result]","${given} [context] ${when} [action] ${then} [result]"]}]

Diagram:
${processedUml}`;

  // Try models in order — first succeeds wins
  const models = [
    'google/gemma-3-27b-it:free',
    'mistralai/mistral-small-3.2-24b-instruct:free',
    'meta-llama/llama-3.3-70b-instruct:free'
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
        lastError = new Error(msg);
        continue; // try next model
      }

      const data = JSON.parse(txt);
      const raw = data?.choices?.[0]?.message?.content || '';
      if (!raw.trim()) { lastError = new Error('Empty response'); continue; }

      const start = raw.indexOf('['), end = raw.lastIndexOf(']');
      if (start === -1 || end === -1) { lastError = new Error('No JSON found'); continue; }

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
            lastError = new Error('JSON parse failed');
            continue;
          }
        } else {
          lastError = new Error('JSON parse failed');
          continue;
        }
      }

      if (!Array.isArray(items) || !items.length) {
        lastError = new Error('Empty array');
        continue;
      }

      return res.status(200).json({ items, model_used: model });

    } catch (err) {
      lastError = err;
      continue;
    }
  }

  return res.status(500).json({ error: lastError?.message || 'Bütün modellər xəta verdi. Yenidən cəhd edin.' });
}
