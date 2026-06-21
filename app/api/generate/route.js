// 서버 측 AI 생성 라우트 — Gemini 키는 여기서만 사용(브라우저 비노출)
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { catOf } from "@/lib/categories";

function buildSystem(cat, subject, target) {
  return `당신은 대한민국 고등학교 학교생활기록부(생기부) 작성을 돕는 전문 보조자입니다. 교사가 입력한 학생 활동 관찰 기록을 바탕으로 교육부 학교생활기록부 기재요령에 부합하는 '${cat.label}'${cat.needsSubject && subject ? ` (과목: ${subject})` : ""} 초안을 작성합니다.

[문체 규칙]
- 명사형 종결('~함', '~음', '~을 보임', '~을 기름' 등)으로 종결한다.
- 학생 이름이나 '나' 등 주어를 쓰지 않는다. 1인칭·구어체·감상문체 금지.
- 관찰 가능한 사실과 구체적 행동을 중심으로, 활동 → 노력·과정 → 역량·성장의 흐름으로 연결한다.
- 추상적 미사여구·과장을 피하고 담백하고 구체적으로 쓴다.
- 여러 활동을 자연스러운 하나의 흐름으로 엮되 단순 나열이 되지 않게 한다.

[영역 관점]
${cat.guide}

[반드시 제외할 항목 — 기재 금지]
- 특정 대학명, 교외 기관·대회명, 교외 수상 실적
- 어학시험·인증시험 점수/급수, 모의고사·교내외 시험 성적
- 부모/친인척의 사회·경제적 지위, 특정 상호·상품명
- 논문 등재, 발명·특허 등 미기재 항목
입력에 이런 내용이 있으면 본문에서 제외하고 notes에 알린다.

[분량] NEIS 기준 약 ${target}바이트(한글 1자=3바이트, 공백·영문·숫자=1바이트, 줄바꿈=2바이트) 이내로 작성한다. 한글 약 ${Math.round(target / 3)}자 내외.

반드시 JSON 형식으로만 출력한다: {"draft": "<생기부 본문>", "notes": "<교사 검토 포인트나 제외한 내용을 1~2문장으로. 없으면 빈 문자열>"}`;
}

function buildUser(cat, activities) {
  const lines = (activities || [])
    .filter((a) => a.title?.trim() || a.detail?.trim() || a.meaning?.trim())
    .map((a, i) => {
      const p = [`활동 ${i + 1}: ${a.title || "(제목 없음)"}`];
      if (a.detail?.trim()) p.push(`  - 한 일/관찰: ${a.detail.trim()}`);
      if (a.meaning?.trim()) p.push(`  - 의미/성장: ${a.meaning.trim()}`);
      return p.join("\n");
    })
    .join("\n\n");
  return `다음은 한 학생의 활동 관찰 기록입니다.\n\n${lines}\n\n위 내용을 종합해 '${cat.label}' 초안을 작성해 주세요.`;
}

async function callGemini(systemText, userText) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  if (!key) throw new Error("GEMINI_API_KEY 미설정");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  return text;
}

function parseResult(text) {
  const clean = (text || "").replace(/```json|```/g, "").trim();
  try {
    const o = JSON.parse(clean);
    return { draft: o.draft || "", notes: o.notes || "" };
  } catch {
    return { draft: clean, notes: "" };
  }
}

export async function POST(request) {
  // 로그인 사용자만 호출 허용
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "잘못된 요청" }, { status: 400 }); }

  const { category, subject = "", target = 1500, activities = [], mode = "generate", draft = "", instruction = "" } = body;
  const cat = catOf(category);

  try {
    let systemText = buildSystem(cat, subject, target);
    let userText;
    if (mode === "refine") {
      userText = `다음은 작성된 '${cat.label}' 초안입니다.\n\n"""${draft}"""\n\n[요청] ${instruction}\n같은 JSON 형식으로만 출력해 주세요.`;
    } else {
      userText = buildUser(cat, activities);
    }
    const text = await callGemini(systemText, userText);
    return NextResponse.json(parseResult(text));
  } catch (e) {
    return NextResponse.json({ error: "생성 실패", detail: String(e?.message || e) }, { status: 500 });
  }
}
