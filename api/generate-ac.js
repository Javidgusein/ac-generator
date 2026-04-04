export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!req.body?.uml) return res.status(400).json({ error: 'Content is required' });

  await new Promise(r => setTimeout(r, 1200));

  return res.status(200).json({
    mock: true,
    items: [
      {
        "id": "AC-001",
        "title": "Proses Başlanğıcı",
        "priority": "High",
        "element_type": "startEvent",
        "diagram_element": "Başla",
        "lane": "İstifadəçi",
        "acceptance_criteria": [
          "Sistem istifadəçi sorğunu qəbul etdikdə prosesi avtomatik olaraq başlatmalıdır.",
          "Sistem prosesin başlanğıc tarixini və vaxtını qeyd etməlidir."
        ]
      },
      {
        "id": "AC-002",
        "title": "Məlumat Daxil Edilməsi",
        "priority": "High",
        "element_type": "userTask",
        "diagram_element": "Məlumatları daxil et",
        "lane": "İstifadəçi",
        "acceptance_criteria": [
          "Sistem istifadəçiyə bütün məcburi sahələri doldurma imkanı verməlidir.",
          "Sistem məcburi sahələr boş qaldıqda formu göndərməyə icazə verməməlidir.",
          "Sistem daxil edilən məlumatların formatını yoxlamalı və uyğunsuzluq olduqda xəta mesajı göstərməlidir."
        ]
      },
      {
        "id": "AC-003",
        "title": "Yoxlama Qərarı Gateway",
        "priority": "High",
        "element_type": "exclusiveGateway",
        "diagram_element": "Məlumat düzgündür?",
        "lane": "Sistem",
        "acceptance_criteria": [
          "Sistem məlumat düzgün olduqda növbəti addıma keçməlidir.",
          "Sistem məlumat yanlış olduqda istifadəçiyə xəta mesajı göstərməli və yenidən daxil etmə imkanı verməlidir."
        ]
      },
      {
        "id": "AC-004",
        "title": "Təsdiq Prosesi",
        "priority": "Medium",
        "element_type": "userTask",
        "diagram_element": "Təsdiq et",
        "lane": "Menecer",
        "acceptance_criteria": [
          "Sistem menecerə təsdiq sorğusunu bildiriş vasitəsilə göndərməlidir.",
          "Sistem menecer tərəfindən təsdiq və ya rədd imkanı təqdim etməlidir.",
          "Sistem təsdiq qərarını tarix və istifadəçi məlumatları ilə birlikdə qeyd etməlidir."
        ]
      },
      {
        "id": "AC-005",
        "title": "Proses Sonu",
        "priority": "Low",
        "element_type": "endEvent",
        "diagram_element": "Bitir",
        "lane": "Sistem",
        "acceptance_criteria": [
          "Sistem bütün addımlar tamamlandıqda prosesi uğurla başa çatdırmalıdır.",
          "Sistem prosesin bitmə tarixini və vaxtını qeyd etməlidir."
        ]
      }
    ]
  });
}
